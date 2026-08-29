import { Archive, ArchiveRestore, ChevronRight, FilePlus2, MoreHorizontal, NotebookPen, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { DesktopBridge, Note } from '../../contracts/desktop-bridge';
import { buildNoteTree, type NoteTreeNode } from './note-tree';
import { resolveNoteDrop, type NoteDropPlacement } from './note-drop';

export function NoteTreeItem({ node, activeId, expanded, onToggle, onSelect, onCreateChild, onRename, onArchive, onDelete, notes, onMove }: {
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
        <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onArchive(node); }}>{node.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}{node.archived ? '恢复归档' : '归档'}</button>
        <button type="button" role="menuitem" className="is-destructive" onClick={() => { setMenuOpen(false); onDelete(node); }}><Trash2 size={13} />删除</button>
      </div>}
    </div>
    {hasChildren && isExpanded && <div className="notes-tree-children">{node.children.map((child) => <NoteTreeItem key={child.id} node={child} activeId={activeId} expanded={expanded} onToggle={onToggle} onSelect={onSelect} onCreateChild={onCreateChild} onRename={onRename} onArchive={onArchive} onDelete={onDelete} notes={notes} onMove={onMove} />)}</div>}
  </div>;
}

export function NotesNavigation({ bridge, activeNoteId, refreshKey = 0, onSelect, onChanged }: { bridge?: DesktopBridge; activeNoteId: string | null; refreshKey?: number; onSelect: (id: string | null) => void; onChanged?: () => void }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(Boolean(bridge));
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    try { return typeof localStorage === 'undefined' ? {} : JSON.parse(localStorage.getItem('yuheng-expanded-notes') ?? '{}') as Record<string, boolean>; } catch { return {}; }
  });
  const tree = useMemo(() => buildNoteTree(notes.filter((note) => note.archived === showArchived)), [notes, showArchived]);
  const refresh = async (preferredId?: string | null) => {
    if (!bridge) return;
    setLoading(true);
    try {
      const items = await bridge.notes.list(true);
      setNotes(items);
      const nextId = preferredId && items.some((item) => item.id === preferredId && item.archived === showArchived)
        ? preferredId
        : activeNoteId && items.some((item) => item.id === activeNoteId && item.archived === showArchived)
          ? activeNoteId
          : items.find((item) => item.archived === showArchived)?.id ?? null;
      if (nextId !== activeNoteId) onSelect(nextId);
      setError(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '加载笔记失败。'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(activeNoteId); }, [bridge, refreshKey, showArchived]);
  useEffect(() => { if (typeof localStorage !== 'undefined') localStorage.setItem('yuheng-expanded-notes', JSON.stringify(expanded)); }, [expanded]);
  const createNote = async (parentId: string | null = null) => {
    if (!bridge) return;
    try { const created = await bridge.notes.create(undefined, parentId); setNotes((current) => [...current, created]); if (parentId) setExpanded((current) => ({ ...current, [parentId]: true })); onSelect(created.id); onChanged?.(); }
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
  if (!bridge) return <div className="notes-nav-empty"><NotebookPen size={18} /><span>连接桌面应用后可使用笔记</span></div>;
  return <div className="notes-navigation" aria-label="笔记导航">
    <div className="notes-nav-heading"><div><strong>笔记</strong><small>{notes.filter((note) => !note.archived).length} 个页面</small></div><button type="button" className="icon-button" onClick={() => void createNote()} aria-label="新建笔记" title="新建笔记"><Plus size={17} /></button></div>
    <div className="notes-tree notes-nav-tree">
      {loading && <div className="notes-tree-empty">正在加载笔记...</div>}
      {!loading && tree.length === 0 && <div className="notes-tree-empty">{showArchived ? '没有归档页面' : '还没有笔记'}</div>}
      {!loading && tree.map((node) => <NoteTreeItem key={node.id} node={node} activeId={activeNoteId} expanded={expanded} onToggle={(id) => setExpanded((current) => ({ ...current, [id]: !(current[id] !== false) }))} onSelect={(id) => onSelect(id)} onCreateChild={(id) => void createNote(id)} onRename={renameNote} onArchive={archiveNote} onDelete={deleteNote} notes={notes} onMove={(id, parentId, targetId) => void moveNote(id, parentId, targetId)} />)}
    </div>
    {error && <p className="notes-nav-error" role="alert">{error}</p>}
    <button type="button" className={`notes-nav-archive ${showArchived ? 'is-active' : ''}`} onClick={() => setShowArchived((current) => !current)}>{showArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}{showArchived ? '返回笔记' : '归档页面'}</button>
  </div>;
}
