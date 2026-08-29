import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArchiveRestore, ChevronRight, FilePlus2, ListTodo, MoreHorizontal, NotebookPen, Plus, Sparkles, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { DesktopBridge, Note } from '../../contracts/desktop-bridge';
import { MarkdownBlockEditor } from '../tasks/markdown-block-editor';
import { buildNoteTree, type NoteTreeNode } from './note-tree';
import { resolveNoteDrop, type NoteDropPlacement } from './note-drop';
import { applyNoteAiResult, type NoteAiAction } from './note-ai';

type NotesWorkspaceProps = { bridge?: DesktopBridge; initialNoteId?: string | null; refreshKey?: number; showNavigation?: boolean; onNotesChanged?: () => void; onActiveNoteChange?: (id: string | null) => void; onAskAi?: (note: Note, action: NoteAiAction, customInstruction?: string) => void; onRunAi?: (note: Note, action: NoteAiAction, customInstruction?: string) => Promise<string>; onCreateTask?: (note: Note) => void };
const UNTITLED_NOTE_TITLE = '未命名笔记';

function NoteTreeItem({ node, activeId, expanded, onToggle, onSelect, onCreateChild, onRename, onArchive, onDelete, notes, onMove }: {
  node: NoteTreeNode;
  activeId: string | null;
  expanded: Record<string, boolean>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onCreateChild: (parentId: string) => void;
  onRename: (node: NoteTreeNode) => void;
  onArchive: (node: NoteTreeNode) => void;
  onDelete: (node: NoteTreeNode) => void;
  notes: Note[];
  onMove: (id: string, parentId: string | null, targetId?: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded[node.id] !== false;
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragOver, setDragOver] = useState<NoteDropPlacement | null>(null);
  return <div className="notes-tree-node">
    <div className={`notes-tree-row ${activeId === node.id ? 'is-selected' : ''} ${dragOver ? `is-drag-over-${dragOver}` : ''}`} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/yuheng-note', node.id); }} onDragEnd={() => setDragOver(null)} onDragOver={(event) => { const draggedId = event.dataTransfer.getData('text/yuheng-note'); if (!draggedId || draggedId === node.id) return; event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); const ratio = (event.clientY - rect.top) / Math.max(1, rect.height); setDragOver(ratio < 0.3 ? 'before' : ratio > 0.7 ? 'after' : 'inside'); }} onDragLeave={() => setDragOver(null)} onDrop={(event) => { event.preventDefault(); const draggedId = event.dataTransfer.getData('text/yuheng-note'); const placement = dragOver; setDragOver(null); if (!draggedId || !placement) return; const target = resolveNoteDrop(notes, draggedId, node.id, placement); if (target) onMove(draggedId, target.parentId, target.targetId); }}>
      <button type="button" className="notes-tree-chevron" onClick={() => onToggle(node.id)} aria-label={hasChildren ? (isExpanded ? '收起子页面' : '展开子页面') : '无子页面'} disabled={!hasChildren}><ChevronRight size={14} className={isExpanded ? 'is-expanded' : ''} /></button>
      <button type="button" className="notes-tree-select" onClick={() => onSelect(node.id)} title={node.title}><NotebookPen size={14} aria-hidden="true" /><span>{node.title}</span></button>
      <button type="button" className="notes-tree-menu-button" aria-label={`管理${node.title}`} title={`管理${node.title}`} aria-expanded={menuOpen} onClick={(event) => { event.stopPropagation(); setMenuOpen((current) => !current); }}><MoreHorizontal size={15} /></button>
      {menuOpen && <div className="notes-tree-menu" role="menu">
        <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onCreateChild(node.id); }}><FilePlus2 size={13} />新建子页面</button>
        <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onRename(node); }}><MoreHorizontal size={13} />重命名</button>
        <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onArchive(node); }}><Archive size={13} />归档</button>
        <button type="button" role="menuitem" className="is-destructive" onClick={() => { setMenuOpen(false); onDelete(node); }}><Trash2 size={13} />删除</button>
      </div>}
    </div>
    {hasChildren && isExpanded && <div className="notes-tree-children">{node.children.map((child) => <NoteTreeItem key={child.id} node={child} activeId={activeId} expanded={expanded} onToggle={onToggle} onSelect={onSelect} onCreateChild={onCreateChild} onRename={onRename} onArchive={onArchive} onDelete={onDelete} notes={notes} onMove={onMove} />)}</div>}
  </div>;
}

export function NotesWorkspace({ bridge, initialNoteId, refreshKey = 0, showNavigation = true, onNotesChanged, onActiveNoteChange, onAskAi, onRunAi, onCreateTask }: NotesWorkspaceProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState<string | null>(initialNoteId ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('yuheng-active-note') : null));
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(Boolean(bridge));
  const [error, setError] = useState<string | null>(null);
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPreview, setAiPreview] = useState<{ action: NoteAiAction; content: string } | null>(null);
  const [undoContent, setUndoContent] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tree = useMemo(() => buildNoteTree(notes.filter((note) => !note.archived)), [notes]);
  const activeNote = notes.find((note) => note.id === activeId) ?? null;

  const setActive = (id: string | null) => {
    setActiveId(id);
    onActiveNoteChange?.(id);
    if (typeof localStorage !== 'undefined') {
      if (id) localStorage.setItem('yuheng-active-note', id);
      else localStorage.removeItem('yuheng-active-note');
    }
  };

  const refresh = async (preferredId?: string | null) => {
    if (!bridge) return;
    setLoading(true);
    try {
      const items = await bridge.notes.list(true);
      setNotes(items);
      const nextId = preferredId && items.some((item) => item.id === preferredId) ? preferredId : activeId && items.some((item) => item.id === activeId) ? activeId : items.find((item) => !item.archived)?.id ?? null;
      setActive(nextId);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载笔记失败。');
    } finally { setLoading(false); }
  };

  useEffect(() => { void refresh(initialNoteId); }, [bridge, initialNoteId, refreshKey]);
  useEffect(() => { if (initialNoteId !== undefined) setActiveId(initialNoteId ?? null); }, [initialNoteId]);
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);
  useEffect(() => { setAiPreview(null); setUndoContent(null); setAiMenuOpen(false); }, [activeId]);

  useEffect(() => {
    if (!bridge || !activeNote || !dirty) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void bridge.notes.update(activeNote.id, { title: activeNote.title, content: activeNote.content }).then((saved) => {
        setNotes((current) => current.map((item) => item.id === saved.id ? saved : item));
        setDirty(false);
        setError(null);
        onNotesChanged?.();
      }).catch((reason) => setError(reason instanceof Error ? reason.message : '保存笔记失败。'));
    }, 500);
  }, [activeNote?.id, activeNote?.title, activeNote?.content, dirty, bridge]);

  const createNote = async (parentId: string | null = null) => {
    if (!bridge) return;
    try {
      const created = await bridge.notes.create(undefined, parentId);
      setNotes((current) => [...current, created]);
      if (parentId) setExpanded((current) => ({ ...current, [parentId]: true }));
      setActive(created.id);
      onNotesChanged?.();
      setDirty(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '新建笔记失败。'); }
  };

  const renameNote = async (node: Pick<Note, 'id' | 'title'>) => {
    const title = window.prompt('笔记名称', node.title)?.trim();
    if (!title || !bridge || title === node.title) return;
    try {
      const updated = await bridge.notes.update(node.id, { title });
      setNotes((current) => current.map((item) => item.id === updated.id ? updated : item));
      onNotesChanged?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '重命名笔记失败。'); }
  };

  const archiveNote = async (node: Pick<Note, 'id' | 'title'>) => {
    if (!bridge) return;
    try {
      const updated = await bridge.notes.update(node.id, { archived: true });
      setNotes((current) => current.map((item) => item.id === updated.id ? updated : item));
      onNotesChanged?.();
      if (activeId === node.id) setActive(notes.find((item) => !item.archived && item.id !== node.id)?.id ?? null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '归档笔记失败。'); }
  };

  const deleteNote = async (node: Pick<Note, 'id' | 'title'>) => {
    if (!bridge || !window.confirm(`删除“${node.title}”及其子页面？此操作无法撤销。`)) return;
    try {
      await bridge.notes.delete(node.id);
      const remaining = notes.filter((item) => item.id !== node.id && item.parentId !== node.id);
      setNotes(remaining);
      if (activeId === node.id) setActive(remaining.find((item) => !item.archived)?.id ?? null);
      else await refresh(activeId);
      onNotesChanged?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '删除笔记失败。'); }
  };

  const moveNote = async (id: string, parentId: string | null, targetId?: string) => {
    if (!bridge) return;
    try {
      await bridge.notes.move(id, parentId, targetId);
      onNotesChanged?.();
      await refresh(id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '移动笔记失败。'); }
  };

  const requestAi = async (action: NoteAiAction, customInstruction?: string) => {
    if (!activeNote || aiBusy) return;
    setAiMenuOpen(false);
    if (!onRunAi) { onAskAi?.(activeNote, action, customInstruction); return; }
    setAiBusy(true);
    setError(null);
    try {
      const content = await onRunAi(activeNote, action, customInstruction);
      setAiPreview({ action, content });
    } catch (reason) { setError(reason instanceof Error ? reason.message : '笔记 AI 操作失败。'); }
    finally { setAiBusy(false); }
  };

  const applyAiPreview = () => {
    if (!activeNote || !aiPreview) return;
    const result = applyNoteAiResult(activeNote.content, aiPreview.action, aiPreview.content);
    setNotes((current) => current.map((item) => item.id === activeNote.id ? { ...item, content: result.content } : item));
    setUndoContent(result.previousContent);
    setAiPreview(null);
    setDirty(true);
  };

  const undoAiApply = () => {
    if (!activeNote || undoContent === null) return;
    setNotes((current) => current.map((item) => item.id === activeNote.id ? { ...item, content: undoContent } : item));
    setUndoContent(null);
    setDirty(true);
  };

  if (!bridge) return <div className="notes-page"><div className="notes-empty-state"><NotebookPen size={28} /><h1>笔记</h1><p>桌面应用连接后可以使用笔记。</p></div></div>;
  return <div className={`notes-page ${showNavigation ? '' : 'notes-page-editor-only'}`}>
    {showNavigation && <aside className="notes-sidebar" aria-label="笔记导航">
      <div className="notes-sidebar-heading"><div><span>笔记</span><small>{notes.filter((note) => !note.archived).length} 个页面</small></div><button type="button" className="icon-button" onClick={() => void createNote()} aria-label="新建笔记" title="新建笔记"><Plus size={17} /></button></div>
      <div className="notes-tree-actions"><button type="button" className="notes-new-page" onClick={() => void createNote()}><FilePlus2 size={15} />新建页面</button></div>
      <div className="notes-tree" aria-label="笔记页面树">
        {loading && <div className="notes-tree-empty">正在加载笔记...</div>}
        {!loading && tree.length === 0 && <div className="notes-tree-empty">还没有笔记</div>}
        {!loading && tree.map((node) => <NoteTreeItem key={node.id} node={node} activeId={activeId} expanded={expanded} onToggle={(id) => setExpanded((current) => ({ ...current, [id]: !(current[id] !== false) }))} onSelect={setActive} onCreateChild={(id) => void createNote(id)} onRename={renameNote} onArchive={archiveNote} onDelete={deleteNote} notes={notes} onMove={(id, parentId, targetId) => void moveNote(id, parentId, targetId)} />)}
      </div>
      <button type="button" className="notes-archive-link" onClick={() => void refresh()}><Archive size={14} />归档页面</button>
    </aside>}
    <section className="notes-editor-shell" aria-label="笔记编辑器">
      {error && <div className="notes-error" role="alert">{error}<button type="button" onClick={() => setError(null)} aria-label="关闭错误">×</button></div>}
      {!activeNote && !loading && <div className="notes-empty-state"><NotebookPen size={32} /><h1>从一页笔记开始</h1><p>记录想法、整理资料，再交给玉衡协助完善。</p><button type="button" className="notes-primary-action" onClick={() => void createNote()}><Plus size={16} />新建笔记</button></div>}
      {activeNote && <div className="notes-editor" key={activeNote.id}>
        <div className="notes-editor-header"><input autoFocus={activeNote.title === UNTITLED_NOTE_TITLE} className="notes-title-input" value={activeNote.title} onFocus={(event) => { if (event.currentTarget.value === UNTITLED_NOTE_TITLE) event.currentTarget.select(); }} onChange={(event) => { const title = event.target.value; setNotes((current) => current.map((item) => item.id === activeNote.id ? { ...item, title } : item)); setDirty(true); }} aria-label="笔记标题" placeholder={UNTITLED_NOTE_TITLE} /><div className="notes-editor-meta"><span className={dirty ? 'is-saving' : ''}>{dirty ? '保存中' : '已保存'}</span>{(onAskAi || onRunAi) && <span className="notes-ai-menu-wrap"><button type="button" className="notes-ai-action" aria-expanded={aiMenuOpen} disabled={aiBusy} onClick={() => setAiMenuOpen((current) => !current)}><Sparkles size={15} />{aiBusy ? '处理中' : '交给玉衡'}</button>{aiMenuOpen && <div className="notes-ai-menu" role="menu" aria-label="笔记 AI 操作">{([['summarize', '总结'], ['rewrite', '改写'], ['expand', '扩展'], ['extract_tasks', '提取任务']] as const).map(([action, label]) => <button type="button" role="menuitem" key={action} onClick={() => void requestAi(action)}>{label}</button>)}<button type="button" role="menuitem" onClick={() => { const instruction = window.prompt('告诉玉衡如何处理这篇笔记'); if (instruction?.trim()) void requestAi('custom', instruction.trim()); }}>自定义指令</button></div>}</span>}{undoContent !== null && <button type="button" className="notes-ai-action" onClick={undoAiApply}>撤销应用</button>}{onCreateTask && <button type="button" className="notes-ai-action" onClick={() => onCreateTask(activeNote)}><ListTodo size={15} />转为任务</button>}<button type="button" className="icon-button" onClick={() => void createNote(activeNote.id)} aria-label="新建子页面" title="新建子页面"><FilePlus2 size={16} /></button><button type="button" className="icon-button" onClick={() => void bridge.notes.update(activeNote.id, { archived: !activeNote.archived }).then((updated) => { setNotes((current) => current.map((item) => item.id === updated.id ? updated : item)); onNotesChanged?.(); })} aria-label={activeNote.archived ? '恢复归档' : '归档笔记'} title={activeNote.archived ? '恢复归档' : '归档笔记'}>{activeNote.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}</button><button type="button" className="icon-button is-destructive" onClick={() => void deleteNote(activeNote)} aria-label="删除笔记" title="删除笔记"><Trash2 size={16} /></button></div></div>
        {aiPreview && <div className="notes-ai-preview" aria-label="AI 结果预览"><div className="notes-ai-preview-heading"><strong>结果预览</strong><span>应用前请确认内容</span></div><div className="notes-ai-preview-content"><ReactMarkdown remarkPlugins={[remarkGfm]}>{aiPreview.content}</ReactMarkdown></div><div className="notes-ai-preview-actions"><button type="button" className="notes-ai-action" onClick={applyAiPreview}>应用到笔记</button><button type="button" className="icon-button" onClick={() => setAiPreview(null)} aria-label="取消预览" title="取消预览"><Trash2 size={15} /></button></div></div>}
        <MarkdownBlockEditor value={activeNote.content} onChange={(content) => { setNotes((current) => current.map((item) => item.id === activeNote.id ? { ...item, content } : item)); setDirty(true); }} />
      </div>}
    </section>
  </div>;
}
