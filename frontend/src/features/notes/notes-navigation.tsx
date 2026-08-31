import { Archive, ArchiveRestore, ChevronDown, ChevronRight, Copy, FilePlus2, MoreHorizontal, NotebookPen, Plus, Star, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DesktopBridge, Note } from '../../contracts/desktop-bridge';
import { buildNoteTree, getNotePath, type NoteTreeNode } from './note-tree';
import { noteDropPlacementFromPointer, resolveNoteDrop, type NoteDropPlacement } from './note-drop';
import { noteLinkMarkdown } from './note-links';
import { getNoteTemplate } from './note-templates';

const NOTES_QUICK_SECTIONS_STORAGE_KEY = 'yuheng-notes-quick-sections';
type NotesNavigationSections = { favorites: boolean; recent: boolean; library: boolean };

export async function runNoteCreation(lock: { current: boolean }, create: () => Promise<void>): Promise<boolean> {
  if (lock.current) return false;
  lock.current = true;
  try {
    await create();
    return true;
  } finally {
    lock.current = false;
  }
}

export function parseNotesNavigationSections(raw: string | null): NotesNavigationSections {
  const fallback: NotesNavigationSections = { favorites: false, recent: false, library: true };
  try {
    const saved = JSON.parse(raw ?? 'null') as Partial<NotesNavigationSections> | null;
    return { favorites: saved?.favorites === true, recent: saved?.recent === true, library: saved?.library !== false };
  } catch {
    return fallback;
  }
}

function loadQuickSections() {
  return parseNotesNavigationSections(typeof localStorage === 'undefined' ? null : localStorage.getItem(NOTES_QUICK_SECTIONS_STORAGE_KEY));
}

export function NoteTreeItem({ node, activeId, expanded, onToggle, onSelect, onCreateChild, onRename, onFavorite, onArchive, onDelete, onCopyLink, notes, onMove }: {
  node: NoteTreeNode;
  activeId: string | null;
  expanded: Record<string, boolean>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onCreateChild: (parentId: string) => void;
  onRename: (node: NoteTreeNode) => void;
  onFavorite: (node: NoteTreeNode) => void;
  onArchive: (node: NoteTreeNode) => void;
  onDelete: (node: NoteTreeNode) => void;
  onCopyLink: (node: NoteTreeNode) => void;
  notes: Note[];
  onMove: (id: string, parentId: string | null, targetId?: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded[node.id] !== false;
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragOver, setDragOver] = useState<NoteDropPlacement | null>(null);
  return <div className="notes-tree-node">
    <div className={`notes-tree-row ${activeId === node.id ? 'is-selected' : ''} ${dragOver ? `is-drag-over-${dragOver}` : ''}`} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/yuheng-note', node.id); }} onDragEnd={() => setDragOver(null)} onDragOver={(event) => { const draggedId = event.dataTransfer.getData('text/yuheng-note'); if (!draggedId || draggedId === node.id) return; event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setDragOver(noteDropPlacementFromPointer(event.clientY, rect.top, rect.height)); }} onDragLeave={() => setDragOver(null)} onDrop={(event) => { event.preventDefault(); const draggedId = event.dataTransfer.getData('text/yuheng-note'); const placement = dragOver; setDragOver(null); if (!draggedId || !placement) return; const target = resolveNoteDrop(notes, draggedId, node.id, placement); if (target) onMove(draggedId, target.parentId, target.targetId); }}>
      <button type="button" className={`notes-tree-chevron notes-nav-tree-leading ${hasChildren ? 'has-children' : ''}`} onClick={() => onToggle(node.id)} aria-label={hasChildren ? (isExpanded ? '收起子页面' : '展开子页面') : '无子页面'} disabled={!hasChildren}><span className="notes-tree-leading-icon" aria-hidden="true">{node.icon ? <span className="notes-tree-icon">{node.icon}</span> : <NotebookPen size={14} />}</span>{hasChildren && <ChevronRight size={14} className={`notes-tree-toggle-icon ${isExpanded ? 'is-expanded' : ''}`} />}</button>
      <button type="button" className="notes-tree-select" onClick={() => onSelect(node.id)} title={node.title}><span>{node.title}</span></button>
      <button type="button" className="notes-tree-create-child" aria-label={`在${node.title}中新建子页面`} title="新建子页面" onClick={(event) => { event.stopPropagation(); onCreateChild(node.id); }}><Plus size={15} /></button>
      <button type="button" className="notes-tree-menu-button" aria-label={`管理${node.title}`} title={`管理${node.title}`} aria-expanded={menuOpen} onClick={(event) => { event.stopPropagation(); setMenuOpen((current) => !current); }}><MoreHorizontal size={15} /></button>
      {menuOpen && <div className="notes-tree-menu" role="menu">
        <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onCreateChild(node.id); }}><FilePlus2 size={13} />新建子页面</button>
        <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onRename(node); }}><MoreHorizontal size={13} />重命名</button>
        <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onCopyLink(node); }}><Copy size={13} />复制页面链接</button>
        <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onFavorite(node); }}><Star size={13} fill={node.favorite ? 'currentColor' : 'none'} />{node.favorite ? '取消收藏' : '收藏'}</button>
        <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onArchive(node); }}>{node.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}{node.archived ? '恢复归档' : '归档'}</button>
        <button type="button" role="menuitem" className="is-destructive" onClick={() => { setMenuOpen(false); onDelete(node); }}><Trash2 size={13} />删除</button>
      </div>}
    </div>
    {hasChildren && isExpanded && <div className="notes-tree-children">{node.children.map((child) => <NoteTreeItem key={child.id} node={child} activeId={activeId} expanded={expanded} onToggle={onToggle} onSelect={onSelect} onCreateChild={onCreateChild} onRename={onRename} onFavorite={onFavorite} onArchive={onArchive} onDelete={onDelete} onCopyLink={onCopyLink} notes={notes} onMove={onMove} />)}</div>}
  </div>;
}

export function NotesNavigation({ bridge, activeNoteId, refreshKey = 0, onSelect, onChanged }: { bridge?: DesktopBridge; activeNoteId: string | null; refreshKey?: number; onSelect: (id: string | null) => void; onChanged?: () => void }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(Boolean(bridge));
  const [error, setError] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const [quickSections, setQuickSections] = useState(loadQuickSections);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    try { return typeof localStorage === 'undefined' ? {} : JSON.parse(localStorage.getItem('yuheng-expanded-notes') ?? '{}') as Record<string, boolean>; } catch { return {}; }
  });
  const refreshGeneration = useRef(0);
  const tree = useMemo(() => buildNoteTree(notes.filter((note) => note.archived === showArchived)), [notes, showArchived]);
  const favoriteNotes = useMemo(() => notes.filter((note) => note.favorite && !note.archived).sort((left, right) => (right.lastOpenedAt ?? right.updatedAt).localeCompare(left.lastOpenedAt ?? left.updatedAt)), [notes]);
  const recentNotes = useMemo(() => notes.filter((note) => !note.archived && note.lastOpenedAt).sort((left, right) => right.lastOpenedAt!.localeCompare(left.lastOpenedAt!)).slice(0, 10), [notes]);
  const revealNote = (id: string, sourceNotes: Note[]) => {
    const ancestors = getNotePath(sourceNotes, id).slice(0, -1);
    if (!ancestors.length) return;
    setExpanded((current) => {
      const next = { ...current };
      ancestors.forEach((ancestor) => { next[ancestor.id] = true; });
      return next;
    });
  };
  const selectNote = (id: string | null, sourceNotes: Note[] = notes) => {
    if (id) revealNote(id, sourceNotes);
    onSelect(id);
    if (id && bridge) void bridge.notes.touch(id).then((updated) => setNotes((current) => current.map((item) => item.id === updated.id ? updated : item))).catch(() => undefined);
  };
  const refresh = async (preferredId?: string | null) => {
    if (!bridge) return;
    const generation = ++refreshGeneration.current;
    setLoading(true);
    try {
      const items = await bridge.notes.list(true);
      if (generation !== refreshGeneration.current) return;
      setNotes(items);
      const nextId = preferredId && items.some((item) => item.id === preferredId && item.archived === showArchived)
        ? preferredId
        : activeNoteId && items.some((item) => item.id === activeNoteId && item.archived === showArchived)
          ? activeNoteId
          : items.find((item) => item.archived === showArchived)?.id ?? null;
      if (nextId) revealNote(nextId, items);
      if (nextId !== activeNoteId) onSelect(nextId);
      setError(null);
    } catch (reason) {
      if (generation === refreshGeneration.current) setError(reason instanceof Error ? reason.message : '加载笔记失败。');
    } finally {
      if (generation === refreshGeneration.current) setLoading(false);
    }
  };
  useEffect(() => { void refresh(activeNoteId); }, [bridge, refreshKey, showArchived]);
  useEffect(() => { if (typeof localStorage !== 'undefined') localStorage.setItem('yuheng-expanded-notes', JSON.stringify(expanded)); }, [expanded]);
  useEffect(() => { if (typeof localStorage !== 'undefined') localStorage.setItem(NOTES_QUICK_SECTIONS_STORAGE_KEY, JSON.stringify(quickSections)); }, [quickSections]);
  const createNote = async (parentId: string | null = null) => {
    if (!bridge) return;
    try {
      await runNoteCreation(creatingRef, async () => {
        setCreating(true);
        try {
          const template = getNoteTemplate('blank');
          const created = await bridge.notes.create({ title: template.title, content: template.content, icon: template.icon, parentId });
          const nextNotes = [...notes, created];
          setNotes(nextNotes);
          selectNote(created.id, nextNotes);
          onChanged?.();
        } finally {
          setCreating(false);
        }
      });
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : '新建笔记失败。'); }
  };
  const renameNote = async (node: Pick<Note, 'id' | 'title'>) => {
    const title = window.prompt('笔记名称', node.title)?.trim();
    if (!title || !bridge || title === node.title) return;
    try { const updated = await bridge.notes.update(node.id, { title }); setNotes((current) => current.map((item) => item.id === updated.id ? updated : item)); onChanged?.(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '重命名笔记失败。'); }
  };
  const archiveNote = async (node: Pick<Note, 'id' | 'title' | 'archived'>) => {
    if (!bridge) return;
    try { const updated = await bridge.notes.update(node.id, { archived: !node.archived }); setNotes((current) => current.map((item) => item.id === updated.id ? updated : item)); if (activeNoteId === node.id && updated.archived !== showArchived) onSelect(notes.find((item) => item.archived === showArchived && item.id !== node.id)?.id ?? null); onChanged?.(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '归档笔记失败。'); }
  };
  const favoriteNote = async (node: Pick<Note, 'id' | 'favorite'>) => {
    if (!bridge) return;
    try { const updated = await bridge.notes.update(node.id, { favorite: !node.favorite }); setNotes((current) => current.map((item) => item.id === updated.id ? updated : item)); onChanged?.(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '更新收藏失败。'); }
  };
  const deleteNote = async (node: Pick<Note, 'id' | 'title'>) => {
    if (!bridge || !window.confirm(`删除“${node.title}”及其子页面？此操作无法撤销。`)) return;
    try { await bridge.notes.delete(node.id); const remaining = notes.filter((item) => item.id !== node.id && item.parentId !== node.id); setNotes(remaining); if (activeNoteId === node.id) onSelect(remaining.find((item) => !item.archived)?.id ?? null); onChanged?.(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '删除笔记失败。'); }
  };
  const moveNote = async (id: string, parentId: string | null, targetId?: string) => {
    if (!bridge) return;
    try { await bridge.notes.move(id, parentId, targetId); await refresh(id); onChanged?.(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '移动笔记失败。'); }
  };
  const copyNoteLink = async (node: Pick<Note, 'id' | 'title'>) => {
    try {
      await navigator.clipboard.writeText(noteLinkMarkdown(node.title, node.id));
      setCopyNotice(`已复制“${node.title}”的页面链接，可粘贴到笔记正文。`);
      window.setTimeout(() => setCopyNotice(null), 2200);
    } catch { setError('无法访问剪贴板，请检查应用权限。'); }
  };
  if (!bridge) return <div className="notes-nav-empty"><NotebookPen size={18} /><span>连接桌面应用后可使用笔记</span></div>;
  return <div className="notes-navigation" aria-label="笔记导航">
    <div className="notes-nav-heading"><strong>笔记</strong><button type="button" className="icon-button" onClick={() => void createNote()} aria-label="新建笔记" title="新建笔记" disabled={creating}><Plus size={17} /></button></div>
    {!showArchived && favoriteNotes.length > 0 && <div className="notes-quick-section"><button type="button" className="notes-quick-heading" aria-expanded={quickSections.favorites} onClick={() => setQuickSections((current) => ({ ...current, favorites: !current.favorites }))}><span>收藏</span><ChevronDown size={13} className={`notes-section-chevron ${quickSections.favorites ? '' : 'is-collapsed'}`} /></button>{quickSections.favorites && <div className="notes-quick-list">{favoriteNotes.map((note) => <button type="button" className={activeNoteId === note.id ? 'is-selected' : ''} key={note.id} onClick={() => selectNote(note.id)}><span>{note.icon ?? '▧'}</span><span>{note.title}</span></button>)}</div>}</div>}
    {!showArchived && recentNotes.length > 0 && <div className="notes-quick-section"><button type="button" className="notes-quick-heading" aria-expanded={quickSections.recent} onClick={() => setQuickSections((current) => ({ ...current, recent: !current.recent }))}><span>最近访问</span><ChevronDown size={13} className={`notes-section-chevron ${quickSections.recent ? '' : 'is-collapsed'}`} /></button>{quickSections.recent && <div className="notes-quick-list">{recentNotes.map((note) => <button type="button" className={activeNoteId === note.id ? 'is-selected' : ''} key={note.id} onClick={() => selectNote(note.id)}><span>{note.icon ?? '▧'}</span><span>{note.title}</span></button>)}</div>}</div>}
    <button type="button" className="notes-quick-heading notes-library-heading" aria-expanded={quickSections.library} onClick={() => setQuickSections((current) => ({ ...current, library: !current.library }))}><span>库</span><ChevronDown size={13} className={`notes-section-chevron ${quickSections.library ? '' : 'is-collapsed'}`} /></button>
    {quickSections.library && <div className="notes-tree notes-nav-tree">
      {loading && <div className="notes-tree-empty">正在加载笔记...</div>}
      {!loading && tree.length === 0 && <div className="notes-tree-empty">{showArchived ? '没有归档页面' : '还没有笔记'}</div>}
      {!loading && tree.map((node) => <NoteTreeItem key={node.id} node={node} activeId={activeNoteId} expanded={expanded} onToggle={(id) => setExpanded((current) => ({ ...current, [id]: !(current[id] !== false) }))} onSelect={(id) => selectNote(id)} onCreateChild={(id) => void createNote(id)} onRename={renameNote} onFavorite={(node) => void favoriteNote(node)} onArchive={archiveNote} onDelete={deleteNote} onCopyLink={(node) => void copyNoteLink(node)} notes={notes} onMove={(id, parentId, targetId) => void moveNote(id, parentId, targetId)} />)}
      {!loading && !showArchived && <button type="button" className="notes-library-create" onClick={() => void createNote()} disabled={creating}><Plus size={14} />新页面</button>}
    </div>}
    {copyNotice && <p className="notes-nav-notice" role="status">{copyNotice}</p>}
    {error && <p className="notes-nav-error" role="alert">{error}</p>}
    <button type="button" className={`notes-nav-archive ${showArchived ? 'is-active' : ''}`} onClick={() => setShowArchived((current) => !current)}>{showArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}{showArchived ? '返回笔记' : '归档页面'}</button>
  </div>;
}
