import { Archive, ArchiveRestore, ChevronDown, ChevronRight, Copy, FilePlus2, FolderPlus, MoreHorizontal, NotebookPen, Plus, Star, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DesktopBridge, KnowledgeBase, Note } from '../../contracts/desktop-bridge';
import { buildNoteTree, getNotePath, type NoteTreeNode } from './note-tree';
import { noteDropPlacementFromPointer, resolveNoteDrop, type NoteDropPlacement } from './note-drop';
import { noteLinkMarkdown } from './note-links';
import { getNoteTemplate } from './note-templates';
import { TextInputDialog } from './text-input-dialog';

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

export function NoteTreeItem({ node, activeId, expanded, onToggle, onSelect, onCreateChild, onRename, onFavorite, onArchive, onDelete, onCopyLink, notes, onMove, knowledgeBases, currentKnowledgeBaseId, onMoveToKnowledgeBase, onCopyToKnowledgeBase }: {
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
  knowledgeBases?: KnowledgeBase[];
  currentKnowledgeBaseId?: string | null;
  onMoveToKnowledgeBase?: (id: string, knowledgeBaseId: string) => void;
  onCopyToKnowledgeBase?: (id: string, knowledgeBaseId: string) => void;
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
        {knowledgeBases?.filter((base) => base.id !== currentKnowledgeBaseId && !base.archived).map((base) => <span key={base.id} className="notes-tree-cross-library-actions"><button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onMoveToKnowledgeBase?.(node.id, base.id); }}><FolderPlus size={13} />移至 {base.name}</button><button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onCopyToKnowledgeBase?.(node.id, base.id); }}><Copy size={13} />复制到 {base.name}</button></span>)}
        <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onFavorite(node); }}><Star size={13} fill={node.favorite ? 'currentColor' : 'none'} />{node.favorite ? '取消收藏' : '收藏'}</button>
        <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onArchive(node); }}>{node.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}{node.archived ? '恢复归档' : '归档'}</button>
        <button type="button" role="menuitem" className="is-destructive" onClick={() => { setMenuOpen(false); onDelete(node); }}><Trash2 size={13} />删除</button>
      </div>}
    </div>
    {hasChildren && isExpanded && <div className="notes-tree-children">{node.children.map((child) => <NoteTreeItem key={child.id} node={child} activeId={activeId} expanded={expanded} onToggle={onToggle} onSelect={onSelect} onCreateChild={onCreateChild} onRename={onRename} onFavorite={onFavorite} onArchive={onArchive} onDelete={onDelete} onCopyLink={onCopyLink} notes={notes} onMove={onMove} knowledgeBases={knowledgeBases} currentKnowledgeBaseId={currentKnowledgeBaseId} onMoveToKnowledgeBase={onMoveToKnowledgeBase} onCopyToKnowledgeBase={onCopyToKnowledgeBase} />)}</div>}
  </div>;
}

export function NotesNavigation({ bridge, activeNoteId, activeKnowledgeBaseId, knowledgeBases: providedKnowledgeBases, refreshKey = 0, onSelect, onSelectKnowledgeBase, onChanged }: { bridge?: DesktopBridge; activeNoteId: string | null; activeKnowledgeBaseId?: string | null; knowledgeBases?: KnowledgeBase[]; refreshKey?: number; onSelect: (id: string | null) => void; onSelectKnowledgeBase?: (id: string) => void; onChanged?: () => void }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>(providedKnowledgeBases ?? []);
  const [selectedKnowledgeBaseId, setSelectedKnowledgeBaseId] = useState<string | null>(activeKnowledgeBaseId ?? providedKnowledgeBases?.[0]?.id ?? null);
  const [expandedKnowledgeBases, setExpandedKnowledgeBases] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(Boolean(bridge));
  const [error, setError] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [libraryMenuOpen, setLibraryMenuOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [textDialog, setTextDialog] = useState<{ title: string; value: string; submit: (value: string) => Promise<void> } | null>(null);
  const creatingRef = useRef(false);
  const [quickSections, setQuickSections] = useState(loadQuickSections);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    try { return typeof localStorage === 'undefined' ? {} : JSON.parse(localStorage.getItem('yuheng-expanded-notes') ?? '{}') as Record<string, boolean>; } catch { return {}; }
  });
  const refreshGeneration = useRef(0);
  const currentKnowledgeBaseId = activeKnowledgeBaseId ?? selectedKnowledgeBaseId;
  const currentNotes = useMemo(() => notes.filter((note) => !currentKnowledgeBaseId || note.knowledgeBaseId === currentKnowledgeBaseId), [notes, currentKnowledgeBaseId]);
  const tree = useMemo(() => buildNoteTree(currentNotes.filter((note) => note.archived === showArchived)), [currentNotes, showArchived]);
  const favoriteNotes = useMemo(() => currentNotes.filter((note) => note.favorite && !note.archived).sort((left, right) => (right.lastOpenedAt ?? right.updatedAt).localeCompare(left.lastOpenedAt ?? left.updatedAt)), [currentNotes]);
  const recentNotes = useMemo(() => currentNotes.filter((note) => !note.archived && note.lastOpenedAt).sort((left, right) => right.lastOpenedAt!.localeCompare(left.lastOpenedAt!)).slice(0, 10), [currentNotes]);
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
      const [items, bases] = await Promise.all([currentKnowledgeBaseId ? bridge.notes.listInKnowledgeBase(currentKnowledgeBaseId, true) : bridge.notes.list(true), bridge.notes.knowledgeBases.list(showArchived)]);
      if (generation !== refreshGeneration.current) return;
      setNotes(items);
      setKnowledgeBases(bases);
      const validBase = currentKnowledgeBaseId && bases.some((base) => base.id === currentKnowledgeBaseId) ? currentKnowledgeBaseId : bases[0]?.id ?? null;
      if (validBase && validBase !== currentKnowledgeBaseId) { setSelectedKnowledgeBaseId(validBase); onSelectKnowledgeBase?.(validBase); }
      const nextId = preferredId && items.some((item) => item.id === preferredId && item.archived === showArchived)
        ? preferredId
        : activeNoteId && items.some((item) => item.id === activeNoteId && item.archived === showArchived)
          ? activeNoteId
          : items.find((item) => item.archived === showArchived)?.id ?? null;
      if (nextId) revealNote(nextId, items);
      if (nextId !== activeNoteId) onSelect(nextId);
      setError(null);
    } catch (reason) {
      if (generation === refreshGeneration.current) setError(reason instanceof Error ? reason.message : '加载知识库失败。');
    } finally {
      if (generation === refreshGeneration.current) setLoading(false);
    }
  };
  useEffect(() => { void refresh(activeNoteId); }, [bridge, refreshKey, showArchived, currentKnowledgeBaseId]);
  useEffect(() => { if (providedKnowledgeBases) setKnowledgeBases(providedKnowledgeBases); }, [providedKnowledgeBases]);
  useEffect(() => { if (activeKnowledgeBaseId) setSelectedKnowledgeBaseId(activeKnowledgeBaseId); }, [activeKnowledgeBaseId]);
  useEffect(() => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.notes-library-row'));
    const cleanups = rows.map((row, index) => {
      row.draggable = true;
      const handleDragStart = (event: DragEvent) => { const base = knowledgeBases[index]; if (!base || (event.target as HTMLElement).closest('.notes-library-pages')) return; event.dataTransfer?.setData('text/yuheng-knowledge-base', base.id); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; };
      row.addEventListener('dragstart', handleDragStart);
      return () => row.removeEventListener('dragstart', handleDragStart);
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [knowledgeBases]);
  useEffect(() => { if (typeof localStorage !== 'undefined') localStorage.setItem('yuheng-expanded-notes', JSON.stringify(expanded)); }, [expanded]);
  useEffect(() => { if (typeof localStorage !== 'undefined') localStorage.setItem(NOTES_QUICK_SECTIONS_STORAGE_KEY, JSON.stringify(quickSections)); }, [quickSections]);
  const createNote = async (parentId: string | null = null, knowledgeBaseOverride?: string | null) => {
    if (!bridge) return;
    try {
      await runNoteCreation(creatingRef, async () => {
        setCreating(true);
        try {
          const template = getNoteTemplate('blank');
          const targetKnowledgeBaseId = knowledgeBaseOverride ?? currentKnowledgeBaseId;
          const created = targetKnowledgeBaseId
            ? await bridge.notes.createInKnowledgeBase(targetKnowledgeBaseId, { title: template.title, content: template.content, icon: template.icon, parentId })
            : await bridge.notes.create({ title: template.title, content: template.content, icon: template.icon, parentId });
          const nextNotes = [...notes, created];
          setNotes(nextNotes);
          selectNote(created.id, nextNotes);
          onChanged?.();
        } finally {
          setCreating(false);
        }
      });
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : '新建页面失败。'); }
  };
  const renameNote = async (node: Pick<Note, 'id' | 'title'>) => {
    setTextDialog({ title: '重命名页面', value: node.title, submit: async (title) => {
      if (!bridge || title === node.title) return;
      try { const updated = await bridge.notes.update(node.id, { title }); setNotes((current) => current.map((item) => item.id === updated.id ? updated : item)); onChanged?.(); }
      catch (reason) { setError(reason instanceof Error ? reason.message : '重命名页面失败。'); }
    } });
  };
  const archiveNote = async (node: Pick<Note, 'id' | 'title' | 'archived'>) => {
    if (!bridge) return;
    try { const updated = await bridge.notes.update(node.id, { archived: !node.archived }); setNotes((current) => current.map((item) => item.id === updated.id ? updated : item)); if (activeNoteId === node.id && updated.archived !== showArchived) onSelect(notes.find((item) => item.archived === showArchived && item.id !== node.id)?.id ?? null); onChanged?.(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '归档页面失败。'); }
  };
  const favoriteNote = async (node: Pick<Note, 'id' | 'favorite'>) => {
    if (!bridge) return;
    try { const updated = await bridge.notes.update(node.id, { favorite: !node.favorite }); setNotes((current) => current.map((item) => item.id === updated.id ? updated : item)); onChanged?.(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '更新收藏失败。'); }
  };
  const deleteNote = async (node: Pick<Note, 'id' | 'title'>) => {
    if (!bridge || !window.confirm(`删除“${node.title}”及其子页面？此操作无法撤销。`)) return;
    try { await bridge.notes.delete(node.id); const remaining = notes.filter((item) => item.id !== node.id && item.parentId !== node.id); setNotes(remaining); if (activeNoteId === node.id) onSelect(remaining.find((item) => !item.archived)?.id ?? null); onChanged?.(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '删除页面失败。'); }
  };
  const moveNote = async (id: string, parentId: string | null, targetId?: string) => {
    if (!bridge) return;
    try { await bridge.notes.move(id, parentId, targetId); await refresh(id); onChanged?.(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '移动页面失败。'); }
  };
  const moveNoteToKnowledgeBase = async (id: string, knowledgeBaseId: string) => {
    if (!bridge) return;
    try { await bridge.notes.moveToKnowledgeBase(id, knowledgeBaseId); await refresh(id); onSelectKnowledgeBase?.(knowledgeBaseId); onChanged?.(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '移动页面失败。'); }
  };
  const copyNoteToKnowledgeBase = async (id: string, knowledgeBaseId: string) => {
    if (!bridge) return;
    try { const copied = await bridge.notes.copyToKnowledgeBase(id, knowledgeBaseId); onSelectKnowledgeBase?.(knowledgeBaseId); await refresh(copied.id); onSelect(copied.id); onChanged?.(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '复制页面失败。'); }
  };
  const copyNoteLink = async (node: Pick<Note, 'id' | 'title'>) => {
    try {
      await navigator.clipboard.writeText(noteLinkMarkdown(node.title, node.id));
      setCopyNotice(`已复制“${node.title}”的页面链接，可粘贴到页面正文。`);
      window.setTimeout(() => setCopyNotice(null), 2200);
    } catch { setError('无法访问剪贴板，请检查应用权限。'); }
  };
  const desktopBridge = bridge;
  const renameKnowledgeBase = async (base: KnowledgeBase) => {
    setTextDialog({ title: '重命名知识库', value: base.name, submit: async (value) => {
      if (value === base.name) return;
      try { const updated = await desktopBridge!.notes.knowledgeBases.update(base.id, { name: value }); setKnowledgeBases((current) => current.map((item) => item.id === updated.id ? updated : item)); onChanged?.(); }
      catch (reason) { setError(reason instanceof Error ? reason.message : '重命名知识库失败。'); }
    } });
  };
  const archiveKnowledgeBase = async (base: KnowledgeBase) => {
    try { const updated = await desktopBridge!.notes.knowledgeBases.update(base.id, { archived: !base.archived }); setKnowledgeBases((current) => { if (updated.archived && !showArchived) return current.filter((item) => item.id !== base.id); return current.some((item) => item.id === updated.id) ? current.map((item) => item.id === updated.id ? updated : item) : [...current, updated].sort((a, b) => a.position - b.position); }); if (updated.archived && currentKnowledgeBaseId === base.id) { const fallback = knowledgeBases.find((item) => item.id !== base.id && !item.archived); if (fallback) onSelectKnowledgeBase?.(fallback.id); } onChanged?.(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '归档知识库失败。'); }
  };
  const deleteKnowledgeBase = async (base: KnowledgeBase) => {
    if (!window.confirm(`删除“${base.name}”及其中的全部页面？页面和历史版本都会被永久删除，此操作无法撤销。`)) return;
    try { await desktopBridge!.notes.knowledgeBases.delete(base.id); setKnowledgeBases((current) => current.filter((item) => item.id !== base.id)); if (currentKnowledgeBaseId === base.id) { const fallback = knowledgeBases.find((item) => item.id !== base.id && !item.archived); if (fallback) onSelectKnowledgeBase?.(fallback.id); } onChanged?.(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '删除知识库失败。'); }
  };
  const reorderKnowledgeBase = async (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    try { const ordered = await desktopBridge!.notes.knowledgeBases.reorder(sourceId, targetId); setKnowledgeBases(ordered); onChanged?.(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '排序知识库失败。'); }
  };
  if (!bridge) return <div className="notes-nav-empty"><NotebookPen size={18} /><span>连接桌面应用后可使用知识库</span></div>;
  return <div className="notes-navigation" aria-label="知识库导航">
    <div className="notes-nav-heading"><strong>页面</strong><button type="button" className="icon-button" onClick={() => void createNote()} aria-label="新建页面" title="新建页面" disabled={creating}><Plus size={17} /></button></div>
    {!showArchived && favoriteNotes.length > 0 && <div className="notes-quick-section"><button type="button" className="notes-quick-heading" aria-expanded={quickSections.favorites} onClick={() => setQuickSections((current) => ({ ...current, favorites: !current.favorites }))}><span>收藏</span><ChevronDown size={13} className={`notes-section-chevron ${quickSections.favorites ? '' : 'is-collapsed'}`} /></button>{quickSections.favorites && <div className="notes-quick-list">{favoriteNotes.map((note) => <button type="button" className={activeNoteId === note.id ? 'is-selected' : ''} key={note.id} onClick={() => selectNote(note.id)}><span>{note.icon ?? '▧'}</span><span>{note.title}</span></button>)}</div>}</div>}
    {!showArchived && recentNotes.length > 0 && <div className="notes-quick-section"><button type="button" className="notes-quick-heading" aria-expanded={quickSections.recent} onClick={() => setQuickSections((current) => ({ ...current, recent: !current.recent }))}><span>最近访问</span><ChevronDown size={13} className={`notes-section-chevron ${quickSections.recent ? '' : 'is-collapsed'}`} /></button>{quickSections.recent && <div className="notes-quick-list">{recentNotes.map((note) => <button type="button" className={activeNoteId === note.id ? 'is-selected' : ''} key={note.id} onClick={() => selectNote(note.id)}><span>{note.icon ?? '▧'}</span><span>{note.title}</span></button>)}</div>}</div>}
    <div className="notes-library-heading-row"><button type="button" className="notes-quick-heading notes-library-heading" aria-expanded={quickSections.library} onClick={() => setQuickSections((current) => ({ ...current, library: !current.library }))}><span>库</span><ChevronDown size={13} className={`notes-section-chevron ${quickSections.library ? '' : 'is-collapsed'}`} /></button><button type="button" className="icon-button notes-library-add" aria-label="新建知识库" title="新建知识库" onClick={() => setTextDialog({ title: '新建知识库', value: '新知识库', submit: async (name) => { try { const created = await bridge.notes.knowledgeBases.create({ name }); setKnowledgeBases((current) => [...current, created]); setSelectedKnowledgeBaseId(created.id); onSelectKnowledgeBase?.(created.id); onChanged?.(); } catch (reason) { setError(reason instanceof Error ? reason.message : '新建知识库失败。'); } } })}><Plus size={15} /></button></div>
    {quickSections.library && <div className="notes-tree notes-nav-tree">
      {knowledgeBases.map((base) => {
        const selected = base.id === currentKnowledgeBaseId;
        const expandedBase = expandedKnowledgeBases[base.id] !== false;
        return <div className={`notes-library-group ${selected ? 'is-selected' : ''}`} key={base.id} onDragOver={(event) => { if (event.dataTransfer.types.includes('text/yuheng-knowledge-base') || event.dataTransfer.types.includes('text/yuheng-note')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }} onDrop={(event) => { event.preventDefault(); const noteId = event.dataTransfer.getData('text/yuheng-note'); const sourceBaseId = event.dataTransfer.getData('text/yuheng-knowledge-base'); if (noteId) void moveNoteToKnowledgeBase(noteId, base.id); else if (sourceBaseId) void reorderKnowledgeBase(sourceBaseId, base.id); }}>
          <div className="notes-library-row" onDragOver={(event) => { if (event.dataTransfer.types.includes('text/yuheng-note')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }} onDrop={(event) => { event.preventDefault(); const noteId = event.dataTransfer.getData('text/yuheng-note'); if (noteId) void moveNoteToKnowledgeBase(noteId, base.id); }}><button type="button" className="notes-library-select" aria-expanded={expandedBase} onClick={() => { setSelectedKnowledgeBaseId(base.id); onSelectKnowledgeBase?.(base.id); }}><span className="notes-library-icon">{base.icon ?? '▧'}</span><span>{base.name}</span>{base.archived && <span className="notes-library-archived">已归档</span>}</button><button type="button" className="notes-library-expand" aria-label={`${expandedBase ? '收起' : '展开'}${base.name}`} title={`${expandedBase ? '收起' : '展开'}${base.name}`} onClick={() => setExpandedKnowledgeBases((current) => ({ ...current, [base.id]: !expandedBase }))}><ChevronRight size={14} className={expandedBase ? 'is-expanded' : ''} /></button><button type="button" className="notes-library-row-add" aria-label={`在${base.name}中新建页面`} title="新建页面" onClick={() => { setSelectedKnowledgeBaseId(base.id); onSelectKnowledgeBase?.(base.id); void createNote(null, base.id); }} disabled={base.archived}><Plus size={14} /></button><button type="button" className="notes-library-menu-button" aria-label={`管理${base.name}`} title={`管理${base.name}`} onClick={(event) => { event.stopPropagation(); setLibraryMenuOpen((current) => current === base.id ? null : base.id); }}><MoreHorizontal size={14} /></button>{libraryMenuOpen === base.id && <div className="notes-library-menu" role="menu"><button type="button" role="menuitem" onClick={() => { setLibraryMenuOpen(null); void renameKnowledgeBase(base); }}>重命名</button><button type="button" role="menuitem" onClick={() => { setLibraryMenuOpen(null); void archiveKnowledgeBase(base); }}>{base.archived ? '恢复知识库' : '归档知识库'}</button>{base.id !== 'default' && <button type="button" role="menuitem" className="is-destructive" onClick={() => { setLibraryMenuOpen(null); void deleteKnowledgeBase(base); }}>删除知识库</button>}</div>}</div>
          {selected && expandedBase && <div className="notes-library-pages">{loading && <div className="notes-tree-empty">正在加载页面...</div>}{!loading && tree.length === 0 && <div className="notes-tree-empty">{showArchived ? '没有归档页面' : '还没有页面'}</div>}{!loading && tree.map((node) => <NoteTreeItem key={node.id} node={node} activeId={activeNoteId} expanded={expanded} onToggle={(id) => setExpanded((current) => ({ ...current, [id]: !(current[id] !== false) }))} onSelect={(id) => selectNote(id)} onCreateChild={(id) => void createNote(id)} onRename={renameNote} onFavorite={(node) => void favoriteNote(node)} onArchive={archiveNote} onDelete={deleteNote} onCopyLink={(node) => void copyNoteLink(node)} notes={notes} onMove={(id, parentId, targetId) => void moveNote(id, parentId, targetId)} knowledgeBases={knowledgeBases} currentKnowledgeBaseId={currentKnowledgeBaseId} onMoveToKnowledgeBase={(id, targetKnowledgeBaseId) => void moveNoteToKnowledgeBase(id, targetKnowledgeBaseId)} onCopyToKnowledgeBase={(id, targetKnowledgeBaseId) => void copyNoteToKnowledgeBase(id, targetKnowledgeBaseId)} />)}</div>}
        </div>;
      })}
      {loading && <div className="notes-tree-empty">正在加载知识库...</div>}
    </div>}
    {copyNotice && <p className="notes-nav-notice" role="status">{copyNotice}</p>}
    {error && <p className="notes-nav-error" role="alert">{error}</p>}
    <button type="button" className={`notes-nav-archive ${showArchived ? 'is-active' : ''}`} onClick={() => setShowArchived((current) => !current)}>{showArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}{showArchived ? '返回页面' : '归档页面'}</button>
    {textDialog && <TextInputDialog title={textDialog.title} value={textDialog.value} onChange={(value) => setTextDialog((current) => current ? { ...current, value } : current)} onCancel={() => setTextDialog(null)} onSubmit={async (value) => { setTextDialog(null); await textDialog.submit(value); }} />}
  </div>;
}
