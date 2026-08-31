import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArchiveRestore, CalendarDays, ChevronRight, ExternalLink, FilePlus2, History, ListTree, ListTodo, Maximize2, Minimize2, MoreHorizontal, NotebookPen, Plus, RotateCcw, Sparkles, Star, Tags, Trash2, Type, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { DesktopBridge, Note, NoteVersion, TaskAsset } from '../../contracts/desktop-bridge';
import { MarkdownBlockEditor, type MentionOption, type NoteLinkOption } from '../tasks/markdown-block-editor';
import { buildNoteTree, getNotePath, sortNotes, type NoteTreeNode } from './note-tree';
import { noteDropPlacementFromPointer, resolveNoteDrop, type NoteDropPlacement } from './note-drop';
import { applyNoteAiResult, diffNoteContent, type NoteAiAction } from './note-ai';
import { ensureNotePageBlocks, NotePageNode } from './note-page-node';
import { noteLinkHref, referencedNoteIds, resolveNotePreview } from './note-links';
import { ContextAiDrawer } from '../ai/context-ai-drawer';
import { builtInNoteCover, BUILT_IN_NOTE_COVERS } from './note-covers';
import { NoteSaveQueue, clearNoteDraft, noteSaveStatus, noteSnapshotEqual, readNoteDraft, saveNoteDraft } from './note-save-queue';
import { getNoteTemplate } from './note-templates';
import { noteOutline } from './note-outline';
import { localDateMention, parseTaskMentionHref, taskMentionHref } from './note-mentions';

type NotesWorkspaceProps = { bridge?: DesktopBridge; initialNoteId?: string | null; refreshKey?: number; showNavigation?: boolean; onNotesChanged?: () => void; onActiveNoteTitleChange?: (title: string) => void; onActiveNoteChange?: (id: string | null) => void; onAskAi?: (note: Note, action: NoteAiAction, customInstruction?: string) => void; onRunAi?: (note: Note, action: NoteAiAction, customInstruction?: string, signal?: AbortSignal) => Promise<string>; onCreateTask?: (note: Note) => void; onOpenTask?: (boardId: string, taskId: string) => void; onImportAsset?: (file: File) => Promise<TaskAsset>; onPickAssets?: () => Promise<TaskAsset[]>; onOpenAsset?: (url: string) => Promise<void> };
const UNTITLED_NOTE_TITLE = '未命名笔记';
type NoteFont = 'default' | 'serif' | 'mono';
type NoteDisplaySettings = { font: NoteFont; fullWidth: boolean; smallText: boolean };
const DEFAULT_NOTE_DISPLAY_SETTINGS: NoteDisplaySettings = { font: 'default', fullWidth: false, smallText: false };
const NOTE_AI_ACTION_LABELS: Record<NoteAiAction, string> = { summarize: '总结', rewrite: '改写', expand: '扩展', extract_tasks: '提取任务', custom: '处理' };

function noteVersionSummary(content: string): string {
  const summary = content.replace(/```[\s\S]*?```/gu, ' ').replace(/[#>*_`~\[\]()-]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  return summary || '空白页面';
}

function loadNoteDisplaySettings(): NoteDisplaySettings {
  if (typeof localStorage === 'undefined') return DEFAULT_NOTE_DISPLAY_SETTINGS;
  try {
    const parsed = JSON.parse(localStorage.getItem('yuheng-note-display-settings') ?? '{}') as Partial<NoteDisplaySettings>;
    return {
      font: parsed.font === 'serif' || parsed.font === 'mono' ? parsed.font : 'default',
      fullWidth: parsed.fullWidth === true,
      smallText: parsed.smallText === true,
    };
  } catch { return DEFAULT_NOTE_DISPLAY_SETTINGS; }
}

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
    <div className={`notes-tree-row ${activeId === node.id ? 'is-selected' : ''} ${dragOver ? `is-drag-over-${dragOver}` : ''}`} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/yuheng-note', node.id); }} onDragEnd={() => setDragOver(null)} onDragOver={(event) => { const draggedId = event.dataTransfer.getData('text/yuheng-note'); if (!draggedId || draggedId === node.id) return; event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setDragOver(noteDropPlacementFromPointer(event.clientY, rect.top, rect.height)); }} onDragLeave={() => setDragOver(null)} onDrop={(event) => { event.preventDefault(); const draggedId = event.dataTransfer.getData('text/yuheng-note'); const placement = dragOver; setDragOver(null); if (!draggedId || !placement) return; const target = resolveNoteDrop(notes, draggedId, node.id, placement); if (target) onMove(draggedId, target.parentId, target.targetId); }}>
      <button type="button" className="notes-tree-chevron" onClick={() => onToggle(node.id)} aria-label={hasChildren ? (isExpanded ? '收起子页面' : '展开子页面') : '无子页面'} disabled={!hasChildren}><ChevronRight size={14} className={isExpanded ? 'is-expanded' : ''} /></button>
      <button type="button" className="notes-tree-select" onClick={() => onSelect(node.id)} title={node.title}>{node.icon ? <span className="notes-tree-icon" aria-hidden="true">{node.icon}</span> : <NotebookPen size={14} aria-hidden="true" />}<span>{node.title}</span></button>
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

export function NotesWorkspace({ bridge, initialNoteId, refreshKey = 0, showNavigation = true, onNotesChanged, onActiveNoteTitleChange, onActiveNoteChange, onAskAi, onRunAi, onCreateTask, onOpenTask, onImportAsset, onPickAssets, onOpenAsset }: NotesWorkspaceProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState<string | null>(initialNoteId ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('yuheng-active-note') : null));
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(Boolean(bridge));
  const [error, setError] = useState<string | null>(null);
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiQuery, setEmojiQuery] = useState('');
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [noteVersions, setNoteVersions] = useState<NoteVersion[]>([]);
  const [peekNoteId, setPeekNoteId] = useState<string | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [activeOutlineIndex, setActiveOutlineIndex] = useState(0);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [mentionTasks, setMentionTasks] = useState<Array<{ id: string; boardId: string; title: string; boardName: string }>>([]);
  const creatingNoteRef = useRef(false);
  const editorScrollRef = useRef<HTMLDivElement>(null);
  const [displaySettings, setDisplaySettings] = useState<NoteDisplaySettings>(loadNoteDisplaySettings);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiActionLabel, setAiActionLabel] = useState('处理');
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [aiPreview, setAiPreview] = useState<{ action: NoteAiAction; content: string; noteId: string; baseContent: string } | null>(null);
  const [undoContent, setUndoContent] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [failedSaveNoteIds, setFailedSaveNoteIds] = useState<Set<string>>(() => new Set());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshGeneration = useRef(0);
  const notesRef = useRef<Note[]>([]);
  const activeNoteRef = useRef<Note | null>(null);
  const dirtyRef = useRef(false);
  const openNoteRef = useRef<(id: string) => void>(() => undefined);
  notesRef.current = notes;
  const notePageExtension = useMemo(() => NotePageNode.configure({
    getTitle: (id) => notesRef.current.find((note) => note.id === id)?.title,
    getIcon: (id) => notesRef.current.find((note) => note.id === id)?.icon,
    onOpen: (id) => openNoteRef.current(id),
  }), []);
  const tree = useMemo(() => buildNoteTree(notes.filter((note) => !note.archived)), [notes]);
  const activeNote = notes.find((note) => note.id === activeId) ?? null;
  const peekNote = peekNoteId ? resolveNotePreview(notes, peekNoteId) : null;
  const activeSaveStatus = activeNote ? noteSaveStatus(dirty, failedSaveNoteIds.has(activeNote.id)) : 'saved';
  activeNoteRef.current = activeNote;
  dirtyRef.current = dirty;
  const saveQueue = useMemo(() => new NoteSaveQueue({
    save: (noteId, snapshot) => bridge ? bridge.notes.update(noteId, snapshot) : Promise.reject(new Error('保存服务不可用。')),
    onSaved: (saved) => {
      setFailedSaveNoteIds((current) => {
        if (!current.has(saved.id)) return current;
        const next = new Set(current);
        next.delete(saved.id);
        return next;
      });
      setNotes((current) => current.map((item) => item.id === saved.id ? saved : item));
      if (activeNoteRef.current?.id === saved.id && noteSnapshotEqual(activeNoteRef.current, saved)) { dirtyRef.current = false; setDirty(false); }
      const storage = typeof localStorage === 'undefined' ? undefined : localStorage;
      const draft = readNoteDraft(storage, saved.id);
      if (!draft || noteSnapshotEqual(draft, saved)) clearNoteDraft(storage, saved.id);
      setError(null);
      if (activeNoteRef.current?.id === saved.id) onActiveNoteTitleChange?.(saved.title);
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('yuheng-note-title-change', { detail: { id: saved.id, title: saved.title } }));
      onNotesChanged?.();
    },
    onError: (noteId, reason) => {
      setFailedSaveNoteIds((current) => new Set(current).add(noteId));
      setError(reason instanceof Error ? reason.message : '保存笔记失败。');
    },
  }), [bridge, onActiveNoteTitleChange, onNotesChanged]);
  const activePath = useMemo(() => activeNote ? getNotePath(notes, activeNote.id) : [], [notes, activeNote?.id]);
  const noteLinkOptions = useMemo<NoteLinkOption[]>(() => notes.filter((note) => !note.archived && note.id !== activeNote?.id).map((note) => ({ id: note.id, title: note.title, icon: note.icon })), [notes, activeNote?.id]);
  const mentionOptions = useMemo<MentionOption[]>(() => {
    const now = new Date();
    return [
      { id: 'today', kind: 'date', title: '今天', detail: localDateMention(now, 0), value: localDateMention(now, 0) },
      { id: 'tomorrow', kind: 'date', title: '明天', detail: localDateMention(now, 1), value: localDateMention(now, 1) },
      ...notes.filter((note) => !note.archived && note.id !== activeNote?.id).map((note): MentionOption => ({ id: note.id, kind: 'note', title: note.title, detail: '页面', icon: note.icon, href: noteLinkHref(note.id) })),
      ...mentionTasks.map((task): MentionOption => ({ id: task.id, kind: 'task', title: task.title, detail: task.boardName, href: taskMentionHref(task.boardId, task.id) })),
    ];
  }, [notes, activeNote?.id, mentionTasks]);
  const backlinks = useMemo(() => {
    if (!activeNote) return [];
    return notes
      .filter((note) => !note.archived && note.id !== activeNote.id && referencedNoteIds(note.content).includes(activeNote.id))
      .sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'));
  }, [activeNote?.id, notes]);
  const noteContent = useMemo(() => {
    if (!activeNote) return '';
    const childIds = sortNotes(notes.filter((note) => note.parentId === activeNote.id && !note.archived)).map((note) => note.id);
    return ensureNotePageBlocks(activeNote.content, childIds);
  }, [activeNote?.id, activeNote?.content, notes]);
  const outline = useMemo(() => noteOutline(noteContent), [noteContent]);
  const childPageKey = useMemo(() => activeNote ? sortNotes(notes.filter((note) => note.parentId === activeNote.id && !note.archived)).map((note) => `${note.id}:${note.title}`).join('|') : '', [activeNote?.id, notes]);

  const setActive = (id: string | null, sourceNotes: Note[] = notes) => {
    setActiveId(id);
    if (id) {
      const ancestors = getNotePath(sourceNotes, id).slice(0, -1);
      if (ancestors.length) setExpanded((current) => {
        const next = { ...current };
        ancestors.forEach((ancestor) => { next[ancestor.id] = true; });
        return next;
      });
    }
    onActiveNoteChange?.(id);
    const selected = sourceNotes.find((note) => note.id === id);
    if (selected) onActiveNoteTitleChange?.(selected.title);
    if (typeof localStorage !== 'undefined') {
      if (id) localStorage.setItem('yuheng-active-note', id);
      else localStorage.removeItem('yuheng-active-note');
    }
  };
  openNoteRef.current = (id) => setActive(id);

  const previewLinkedNote = (id: string) => {
    const linked = resolveNotePreview(notes, id);
    if (!linked) {
      setError('该页面已归档或不存在。');
      return;
    }
    setHistoryOpen(false);
    setPeekNoteId(id);
  };

  useEffect(() => {
    if (!activeNote || noteContent === activeNote.content) return;
    setNotes((current) => current.map((item) => item.id === activeNote.id ? { ...item, content: noteContent } : item));
    setDirty(true);
  }, [activeNote?.id, activeNote?.content, noteContent]);

  const refresh = async (preferredId?: string | null) => {
    if (!bridge) return;
    const pendingNote = activeNoteRef.current;
    if (pendingNote && dirtyRef.current) {
      saveNoteDraft(typeof localStorage === 'undefined' ? undefined : localStorage, pendingNote.id, pendingNote);
      saveQueue.enqueue(pendingNote.id, pendingNote);
      await saveQueue.flush(pendingNote.id);
      if (saveQueue.hasPending(pendingNote.id)) return;
    }
    const generation = ++refreshGeneration.current;
    setLoading(true);
    try {
      const items = await bridge.notes.list(true);
      if (generation !== refreshGeneration.current) return;
      setNotes(items);
      const nextId = preferredId && items.some((item) => item.id === preferredId) ? preferredId : activeId && items.some((item) => item.id === activeId) ? activeId : items.find((item) => !item.archived)?.id ?? null;
      setActive(nextId, items);
      if (nextId) {
        const storage = typeof localStorage === 'undefined' ? undefined : localStorage;
        const draft = readNoteDraft(storage, nextId);
        const current = items.find((item) => item.id === nextId);
        if (draft && current && !noteSnapshotEqual(draft, current)) {
          if (window.confirm('发现这篇笔记有未提交的本地编辑，是否恢复？')) {
            setNotes((existing) => existing.map((item) => item.id === nextId ? { ...item, ...draft } : item));
            setDirty(true);
          } else clearNoteDraft(storage, nextId);
        } else if (draft) clearNoteDraft(storage, nextId);
      }
      setError(null);
    } catch (reason) {
      if (generation === refreshGeneration.current) setError(reason instanceof Error ? reason.message : '加载笔记失败。');
    } finally {
      if (generation === refreshGeneration.current) setLoading(false);
    }
  };

  useEffect(() => { void refresh(initialNoteId); }, [bridge, initialNoteId, refreshKey]);
  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    void bridge.tasks.boards.list().then(async (boards) => {
      const taskLists = await Promise.all(boards.map(async (board) => ({ board, tasks: await bridge.tasks.list(board.id) })));
      if (!cancelled) setMentionTasks(taskLists.flatMap(({ board, tasks }) => tasks.map((task) => ({ id: task.id, boardId: board.id, title: task.title, boardName: board.name }))));
    }).catch(() => { if (!cancelled) setMentionTasks([]); });
    return () => { cancelled = true; };
  }, [bridge]);
  useEffect(() => { if (initialNoteId !== undefined) setActiveId(initialNoteId ?? null); }, [initialNoteId]);
  useEffect(() => {
    if (!bridge || !activeId) return;
    void bridge.notes.touch(activeId).then((updated) => setNotes((current) => current.map((item) => item.id === updated.id ? updated : item))).catch(() => undefined);
  }, [bridge, activeId]);
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const note = activeId ? notesRef.current.find((item) => item.id === activeId) : null;
    if (!note) return;
    const storage = typeof localStorage === 'undefined' ? undefined : localStorage;
    if (!readNoteDraft(storage, note.id)) return;
    saveNoteDraft(storage, note.id, note);
    saveQueue.enqueue(note.id, note);
    void saveQueue.flush(note.id);
  }, [activeId, saveQueue]);
  useEffect(() => { setAiPreview(null); setUndoContent(null); setPageMenuOpen(false); setAiNotice(null); setEmojiPickerOpen(false); setCoverPickerOpen(false); setHistoryOpen(false); setNoteVersions([]); setPeekNoteId(null); setOutlineOpen(false); setActiveOutlineIndex(0); setPropertiesOpen(false); }, [activeId]);
  useEffect(() => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('yuheng-note-display-settings', JSON.stringify(displaySettings));
  }, [displaySettings]);
  useEffect(() => {
    if (!pageMenuOpen) return;
    const close = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.notes-page-menu-wrap')) setPageMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPageMenuOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape); };
  }, [pageMenuOpen]);
  useEffect(() => {
    if (!outlineOpen) return;
    const close = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.notes-outline-wrap')) setOutlineOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOutlineOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape); };
  }, [outlineOpen]);
  useEffect(() => {
    const container = editorScrollRef.current;
    if (!container || outline.length < 2) return;
    const update = () => {
      const headings = Array.from(container.querySelectorAll<HTMLElement>('.ProseMirror h1, .ProseMirror h2, .ProseMirror h3'));
      const boundary = container.getBoundingClientRect().top + 96;
      let current = 0;
      headings.forEach((heading, index) => { if (heading.getBoundingClientRect().top <= boundary) current = index; });
      setActiveOutlineIndex(current);
    };
    update();
    container.addEventListener('scroll', update, { passive: true });
    return () => container.removeEventListener('scroll', update);
  }, [activeNote?.id, outline.length]);

  useEffect(() => {
    if (!bridge || !activeNote || !dirty) return;
    setFailedSaveNoteIds((current) => {
      if (!current.has(activeNote.id)) return current;
      const next = new Set(current);
      next.delete(activeNote.id);
      return next;
    });
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveNoteDraft(typeof localStorage === 'undefined' ? undefined : localStorage, activeNote.id, activeNote);
    saveTimer.current = setTimeout(() => {
      saveQueue.enqueue(activeNote.id, activeNote);
    }, 500);
  }, [activeNote?.id, activeNote?.title, activeNote?.content, activeNote?.icon, activeNote?.cover, JSON.stringify(activeNote?.properties), dirty, bridge, saveQueue]);

  const createNote = async (parentId: string | null = null) => {
    if (!bridge || creatingNoteRef.current) return;
    creatingNoteRef.current = true;
    try {
      const template = getNoteTemplate('blank');
      const created = await bridge.notes.create({ title: template.title, content: template.content, icon: template.icon, parentId });
      const nextNotes = [...notes, created];
      setNotes(nextNotes);
      setActive(created.id, nextNotes);
      onNotesChanged?.();
      setDirty(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '新建笔记失败。'); }
    finally { creatingNoteRef.current = false; }
  };

  const retryActiveNoteSave = () => {
    if (!activeNote) return;
    setFailedSaveNoteIds((current) => {
      if (!current.has(activeNote.id)) return current;
      const next = new Set(current);
      next.delete(activeNote.id);
      return next;
    });
    setError(null);
    saveQueue.retry(activeNote.id);
  };

  const toggleFavorite = async () => {
    if (!activeNote || !bridge) return;
    try {
      const updated = await bridge.notes.update(activeNote.id, { favorite: !activeNote.favorite });
      setNotes((current) => current.map((item) => item.id === updated.id ? updated : item));
      onNotesChanged?.();
      setPageMenuOpen(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '更新收藏失败。'); }
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

  const updateDecoration = (patch: { icon?: string | null; cover?: string | null }) => {
    if (!activeNote || !bridge) return;
    setNotes((current) => current.map((item) => item.id === activeNote.id ? { ...item, ...patch } : item));
    setDirty(true);
  };

  const updateProperties = (patch: Partial<Note['properties']>) => {
    if (!activeNote) return;
    setNotes((current) => current.map((item) => item.id === activeNote.id ? { ...item, properties: { ...item.properties, ...patch } } : item));
    setDirty(true);
  };

  const chooseCustomCover = async () => {
    if (!activeNote || !bridge) return;
    try {
      const cover = await bridge.notes.covers.pick();
      if (cover) { updateDecoration({ cover: cover.url }); setCoverPickerOpen(false); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : '上传封面失败。'); }
  };

  const chooseBuiltInCover = (coverId: string) => {
    updateDecoration({ cover: coverId });
    setCoverPickerOpen(false);
  };

  const openVersionHistory = async () => {
    if (!activeNote || !bridge) return;
    setPageMenuOpen(false);
    setPeekNoteId(null);
    setHistoryOpen(true);
    setHistoryLoading(true);
    setError(null);
    try {
      if (dirty) {
        saveQueue.enqueue(activeNote.id, activeNote);
        await saveQueue.flush(activeNote.id);
        if (saveQueue.hasPending(activeNote.id)) throw new Error('请先完成当前页面保存，再查看版本历史。');
      }
      setNoteVersions(await bridge.notes.versions.list(activeNote.id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : '加载版本历史失败。'); }
    finally { setHistoryLoading(false); }
  };

  const restoreVersion = async (version: NoteVersion) => {
    if (!activeNote || !bridge || !window.confirm(`恢复 ${new Date(version.createdAt).toLocaleString('zh-CN')} 的版本？当前内容会保留在历史中。`)) return;
    setHistoryLoading(true);
    try {
      const restored = await bridge.notes.versions.restore(activeNote.id, version.id);
      setNotes((current) => current.map((item) => item.id === restored.id ? restored : item));
      clearNoteDraft(typeof localStorage === 'undefined' ? undefined : localStorage, restored.id);
      setDirty(false);
      setNoteVersions(await bridge.notes.versions.list(restored.id));
      onActiveNoteTitleChange?.(restored.title);
      onNotesChanged?.();
      setError(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '恢复历史版本失败。'); }
    finally { setHistoryLoading(false); }
  };

  const requestAi = async (action: NoteAiAction, customInstruction?: string) => {
    if (!activeNote || aiBusy) return;
    const requestedNoteId = activeNote.id;
    const baseContent = activeNote.content;
    setPageMenuOpen(false);
    setAiActionLabel(NOTE_AI_ACTION_LABELS[action]);
    setAiNotice(null);
    if (!onRunAi) {
      onAskAi?.(activeNote, action, customInstruction);
      setAiNotice(`${NOTE_AI_ACTION_LABELS[action]}请求已发送`);
      window.setTimeout(() => setAiNotice(null), 1800);
      return;
    }
    setAiBusy(true);
    setError(null);
    try {
      const content = await onRunAi(activeNote, action, customInstruction);
      if (activeId === requestedNoteId) setAiPreview({ action, content, noteId: requestedNoteId, baseContent });
    } catch (reason) { setError(reason instanceof Error ? reason.message : '笔记 AI 操作失败。'); }
    finally { setAiBusy(false); }
  };

  const applyAiPreview = () => {
    if (!activeNote || !aiPreview) return;
    if (aiPreview.noteId !== activeNote.id || aiPreview.baseContent !== activeNote.content) {
      setAiPreview(null);
      setError('笔记内容已发生变化，请重新生成 AI 结果。');
      return;
    }
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
      {error && <div className="notes-error" role="alert">{error}{activeNote && saveQueue.hasPending(activeNote.id) && <button type="button" onClick={retryActiveNoteSave}>重试保存</button>}<button type="button" onClick={() => setError(null)} aria-label="关闭错误">×</button></div>}
      {!activeNote && !loading && <div className="notes-empty-state"><NotebookPen size={32} /><h1>从一页笔记开始</h1><p>记录想法、整理资料，再交给玉衡协助完善。</p><button type="button" className="notes-primary-action" onClick={() => void createNote()}><Plus size={16} />新建笔记</button></div>}
      {activeNote && <nav className="notes-breadcrumb notes-shell-breadcrumb" aria-label="笔记路径">{activePath.map((item, index) => <span className="notes-breadcrumb-item" key={item.id}>{index > 0 && <ChevronRight size={13} aria-hidden="true" />}{index === activePath.length - 1 ? <span aria-current="page">{item.title}</span> : <button type="button" onClick={() => setActive(item.id)}>{item.title}</button>}</span>)}</nav>}
      {activeNote && <div ref={editorScrollRef} className={`notes-editor has-breadcrumb ${displaySettings.fullWidth ? 'is-full-width' : ''} notes-font-${displaySettings.font} ${displaySettings.smallText ? 'is-small-text' : ''}`} key={activeNote.id}>
        {activeNote.cover && <div className="notes-cover" style={builtInNoteCover(activeNote.cover) ? { background: builtInNoteCover(activeNote.cover)?.background, ...(builtInNoteCover(activeNote.cover)?.image ? { backgroundImage: `url(${builtInNoteCover(activeNote.cover)?.image})` } : {}) } : { backgroundImage: `url(${activeNote.cover})` }} role="img" aria-label="页面封面" />}
        <div className="notes-decoration-tools" onMouseLeave={() => { if (!emojiPickerOpen && !coverPickerOpen) setEmojiPickerOpen(false); }}><button type="button" onClick={() => { setEmojiPickerOpen((value) => !value); setCoverPickerOpen(false); setEmojiQuery(''); }}><span className="notes-decoration-icon">{activeNote.icon ?? '●'}</span>添加图标</button><button type="button" onClick={() => { setCoverPickerOpen((value) => !value); setEmojiPickerOpen(false); }}>▧ {activeNote.cover ? '更换封面' : '添加 Cover'}</button><button type="button" onClick={() => void chooseCustomCover()}>上传图片</button>{activeNote.cover && <button type="button" onClick={() => updateDecoration({ cover: null })}>移除封面</button>}{emojiPickerOpen && <div className="notes-emoji-picker" role="dialog" aria-label="选择页面图标"><input value={emojiQuery} onChange={(event) => setEmojiQuery(event.target.value)} placeholder="搜索 emoji" aria-label="搜索 emoji" autoFocus /><div className="notes-emoji-grid">{['📚','📝','📌','💡','⭐','✅','🎯','🚀','🌱','🎨','💬','🔖','🧭','🗂️','📅','🏠','❤️','🔥','🔍','⚙️'].filter((emoji) => !emojiQuery || emoji.includes(emojiQuery)).map((emoji) => <button type="button" key={emoji} onClick={() => { updateDecoration({ icon: emoji }); setEmojiPickerOpen(false); }}>{emoji}</button>)}</div><button type="button" className="notes-emoji-clear" onClick={() => { updateDecoration({ icon: null }); setEmojiPickerOpen(false); }}>清除图标</button></div>}{coverPickerOpen && <div className="notes-cover-picker" role="dialog" aria-label="选择页面封面"><div className="notes-cover-picker-header"><strong>选择封面</strong><button type="button" onClick={() => setCoverPickerOpen(false)} aria-label="关闭封面选择器">×</button></div><div className="notes-cover-picker-tabs"><span className="is-active">图库</span><button type="button" onClick={() => void chooseCustomCover()}>上传图片</button></div><div className="notes-cover-picker-grid">{BUILT_IN_NOTE_COVERS.map((cover) => <button type="button" key={cover.id} className={activeNote.cover === cover.id ? 'is-selected' : ''} onClick={() => chooseBuiltInCover(cover.id)} style={{ background: cover.background, ...(cover.image ? { backgroundImage: `url(${cover.image})` } : {}) }} aria-label={cover.label}><span>{cover.label}</span></button>)}</div>{activeNote.cover && <button type="button" className="notes-cover-picker-remove" onClick={() => { updateDecoration({ cover: null }); setCoverPickerOpen(false); }}>移除封面</button>}</div>}</div>
        <div className="notes-editor-header">
          <div className="notes-title-line"><span className="notes-title-icon">{activeNote.icon}</span><input autoFocus={activeNote.title === UNTITLED_NOTE_TITLE} className="notes-title-input" value={activeNote.title} onFocus={(event) => { if (event.currentTarget.value === UNTITLED_NOTE_TITLE) event.currentTarget.select(); }} onChange={(event) => { const title = event.target.value; setNotes((current) => current.map((item) => item.id === activeNote.id ? { ...item, title } : item)); setDirty(true); }} aria-label="笔记标题" placeholder={UNTITLED_NOTE_TITLE} /></div>
          <div className="notes-page-actions">
            <span className={activeSaveStatus === 'saving' ? 'is-saving' : activeSaveStatus === 'failed' ? 'is-save-failed' : ''}>{activeSaveStatus === 'saving' ? '保存中' : activeSaveStatus === 'failed' ? '保存失败' : '已保存'}</span>
            {outline.length >= 2 && <span className="notes-outline-wrap"><button type="button" className="notes-page-outline" aria-label="页面目录" title="页面目录" aria-expanded={outlineOpen} onClick={() => { setPageMenuOpen(false); setOutlineOpen((current) => !current); }}><ListTree size={17} /></button>{outlineOpen && <div className="notes-outline-menu" role="navigation" aria-label="页面目录"><div className="notes-outline-heading">目录</div>{outline.map((item) => <button type="button" key={`${item.index}-${item.text}`} className={item.index === activeOutlineIndex ? 'is-active' : ''} style={{ paddingLeft: 9 + (item.level - 1) * 14 }} onClick={() => { const heading = editorScrollRef.current?.querySelectorAll<HTMLElement>('.ProseMirror h1, .ProseMirror h2, .ProseMirror h3')[item.index]; heading?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); setActiveOutlineIndex(item.index); setOutlineOpen(false); }}>{item.text}</button>)}</div>}</span>}
            <button type="button" className={`notes-page-favorite ${activeNote.favorite ? 'is-active' : ''}`} aria-label={activeNote.favorite ? '取消收藏页面' : '收藏页面'} title={activeNote.favorite ? '取消收藏' : '收藏'} aria-pressed={activeNote.favorite} onClick={() => void toggleFavorite()}><Star size={17} fill={activeNote.favorite ? 'currentColor' : 'none'} /></button>
            <span className="notes-page-menu-wrap"><button type="button" className="notes-page-more" aria-label="页面设置" aria-expanded={pageMenuOpen} onClick={() => setPageMenuOpen((current) => !current)}><MoreHorizontal size={19} /></button>{pageMenuOpen && <div className="notes-page-menu" role="menu" aria-label="页面设置"><div className="notes-page-menu-heading">页面设置</div><div className="notes-page-fonts" role="group" aria-label="页面字体">{([['default', 'Ag', '默认'], ['serif', 'Ag', '衬线'], ['mono', 'Ag', '等宽']] as const).map(([font, sample, label]) => <button type="button" key={font} className={displaySettings.font === font ? 'is-selected' : ''} onClick={() => setDisplaySettings((current) => ({ ...current, font }))}><strong className={`notes-font-sample notes-font-${font}`}>{sample}</strong><span>{label}</span></button>)}</div><button type="button" className="notes-page-menu-item" role="menuitem" onClick={() => setDisplaySettings((current) => ({ ...current, fullWidth: !current.fullWidth }))}>{displaySettings.fullWidth ? <Minimize2 size={15} /> : <Maximize2 size={15} />}<span>全宽</span><small>{displaySettings.fullWidth ? '开启' : '关闭'}</small></button><button type="button" className="notes-page-menu-item" role="menuitem" onClick={() => setDisplaySettings((current) => ({ ...current, smallText: !current.smallText }))}><Type size={15} /><span>小字号</span><small>{displaySettings.smallText ? '开启' : '关闭'}</small></button><button type="button" className="notes-page-menu-item" role="menuitem" onClick={() => void openVersionHistory()}><History size={15} /><span>版本历史</span></button><div className="notes-page-menu-separator" />{(onAskAi || onRunAi) && <>{([['summarize', '总结'], ['rewrite', '改写'], ['expand', '扩展'], ['extract_tasks', '提取任务']] as const).map(([action, label]) => <button type="button" role="menuitem" className="notes-page-menu-item" key={action} onClick={() => void requestAi(action)}><Sparkles size={15} /><span>{label}</span></button>)}<button type="button" role="menuitem" className="notes-page-menu-item" onClick={() => { const instruction = window.prompt('告诉玉衡如何处理这篇笔记'); if (instruction?.trim()) void requestAi('custom', instruction.trim()); }}><Sparkles size={15} /><span>自定义指令</span></button></>}{undoContent !== null && <button type="button" role="menuitem" className="notes-page-menu-item" onClick={undoAiApply}>撤销应用</button>}{onCreateTask && <button type="button" role="menuitem" className="notes-page-menu-item" onClick={() => { setPageMenuOpen(false); onCreateTask(activeNote); }}><ListTodo size={15} /><span>转为任务</span></button>}<button type="button" role="menuitem" className="notes-page-menu-item" onClick={() => { setPageMenuOpen(false); void createNote(activeNote.id); }}><FilePlus2 size={15} /><span>新建子页面</span></button><button type="button" role="menuitem" className="notes-page-menu-item" onClick={() => { setPageMenuOpen(false); void bridge.notes.update(activeNote.id, { archived: !activeNote.archived }).then((updated) => { setNotes((current) => current.map((item) => item.id === updated.id ? updated : item)); onNotesChanged?.(); }); }}><Archive size={15} /><span>{activeNote.archived ? '恢复归档' : '归档页面'}</span></button><button type="button" role="menuitem" className="notes-page-menu-item is-destructive" onClick={() => { setPageMenuOpen(false); void deleteNote(activeNote); }}><Trash2 size={15} /><span>删除页面</span></button></div>}</span>
          </div>
        </div>
        {(propertiesOpen || activeNote.properties.status || activeNote.properties.date || activeNote.properties.tags.length > 0) ? <section className="notes-properties" aria-label="页面属性"><label><span>状态</span><input value={activeNote.properties.status ?? ''} onChange={(event) => updateProperties({ status: event.target.value || null })} placeholder="添加状态" maxLength={80} /></label><label><span><CalendarDays size={14} />日期</span><input type="date" value={activeNote.properties.date ?? ''} onChange={(event) => updateProperties({ date: event.target.value || null })} /></label><label><span><Tags size={14} />标签</span><input value={activeNote.properties.tags.join(', ')} onChange={(event) => updateProperties({ tags: event.target.value.split(/[,，]/u).map((tag) => tag.trim()).filter(Boolean) })} placeholder="用逗号分隔" /></label><button type="button" className="notes-properties-hide" onClick={() => setPropertiesOpen(false)}>收起属性</button></section> : <button type="button" className="notes-add-properties" onClick={() => setPropertiesOpen(true)}><Plus size={14} />添加属性</button>}
        {aiBusy && <div className="notes-ai-progress" role="status" aria-live="polite"><span className="notes-ai-progress-icon"><Sparkles size={16} /></span><span><strong>正在{aiActionLabel}…</strong><small>玉衡正在处理这篇笔记，完成后会显示结果预览。</small></span><span className="notes-ai-progress-dots" aria-hidden="true">···</span></div>}
        {!aiBusy && aiNotice && <div className="notes-ai-notice" role="status" aria-live="polite"><Sparkles size={14} />{aiNotice}</div>}
        {aiPreview && <div className="notes-ai-preview" aria-label="AI 结果预览"><div className="notes-ai-preview-heading"><strong>结果预览</strong><span>应用前请确认内容</span></div><div className="notes-ai-preview-content"><div className="notes-ai-diff" role="list" aria-label="内容差异">{diffNoteContent(aiPreview.baseContent, aiPreview.content).map((line, index) => <div className={`notes-ai-diff-line is-${line.kind}`} key={`${line.kind}-${index}`} role="listitem"><span aria-hidden="true">{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}</span><code>{line.text || ' '}</code></div>)}</div></div><div className="notes-ai-preview-actions"><button type="button" className="notes-ai-action" onClick={applyAiPreview}>应用到笔记</button><button type="button" className="icon-button" onClick={() => setAiPreview(null)} aria-label="取消预览" title="取消预览"><Trash2 size={15} /></button></div></div>}
        <MarkdownBlockEditor key={`${activeNote.id}:${childPageKey}`} value={noteContent} extensions={[notePageExtension]} noteLinkOptions={noteLinkOptions} noteLinkHref={noteLinkHref} onOpenNote={previewLinkedNote} mentionOptions={mentionOptions} onOpenTask={onOpenTask} onMoveBlock={async (targetId, sourceContent, blockMarkdown) => { const moved = await bridge.notes.moveBlock(activeNote.id, targetId, sourceContent, blockMarkdown); setNotes((current) => current.map((item) => item.id === moved.target.id ? moved.target : item)); onNotesChanged?.(); }} onImportAsset={onImportAsset} onPickAssets={onPickAssets} onOpenAsset={onOpenAsset} floatingToolbar blockRangeSelection onChange={(content) => { setNotes((current) => current.map((item) => item.id === activeNote.id ? { ...item, content } : item)); setDirty(true); }} />
        {backlinks.length > 0 && <section className="notes-backlinks" aria-label="反向链接"><div className="notes-backlinks-heading"><strong>反向链接</strong><span>{backlinks.length}</span></div><div className="notes-backlinks-list">{backlinks.map((note) => <button type="button" key={note.id} onClick={() => setActive(note.id)}><span>{note.icon ?? '▧'}</span><span>{note.title}</span></button>)}</div></section>}
        {onRunAi && <ContextAiDrawer sourceLabel={`“${activeNote.title}”`} onSend={(prompt, signal) => onRunAi(activeNote, 'custom', prompt, signal)} />}
      </div>}
      {activeNote && historyOpen && <aside className="notes-history-panel" aria-label="版本历史"><header><div><History size={16} /><strong>版本历史</strong></div><button type="button" aria-label="关闭版本历史" onClick={() => setHistoryOpen(false)}><X size={17} /></button></header><div className="notes-history-list">{historyLoading && noteVersions.length === 0 && <div className="notes-history-empty">正在加载历史...</div>}{!historyLoading && noteVersions.length === 0 && <div className="notes-history-empty">还没有可恢复的历史版本</div>}{noteVersions.map((version) => <article key={version.id}><div className="notes-history-meta"><time dateTime={version.createdAt}>{new Date(version.createdAt).toLocaleString('zh-CN')}</time><button type="button" onClick={() => void restoreVersion(version)} disabled={historyLoading}><RotateCcw size={14} />恢复</button></div><strong>{version.icon ? `${version.icon} ` : ''}{version.title}</strong><p>{noteVersionSummary(version.content)}</p></article>)}</div></aside>}
      {activeNote && peekNote && <aside className="notes-peek-panel" aria-label={`预览页面：${peekNote.title}`}><header><div><span aria-hidden="true">{peekNote.icon ?? '▧'}</span><strong>{peekNote.title}</strong></div><div><button type="button" onClick={() => { setActive(peekNote.id); setPeekNoteId(null); }} title="完整打开页面"><ExternalLink size={16} /></button><button type="button" aria-label="关闭页面预览" onClick={() => setPeekNoteId(null)}><X size={17} /></button></div></header><div className="notes-peek-content"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} onClick={(event) => { event.preventDefault(); if (!href) return; if (href.startsWith('yuheng-note://')) { try { previewLinkedNote(decodeURIComponent(href.slice('yuheng-note://'.length))); } catch { setError('页面链接无效。'); } return; } const taskIdentity = parseTaskMentionHref(href); if (taskIdentity) { onOpenTask?.(taskIdentity.boardId, taskIdentity.taskId); return; } if (href.startsWith('http://') || href.startsWith('https://')) void bridge.app.openExternal(href); }}>{children}</a>, img: ({ alt }) => <span className="notes-peek-image-placeholder">[图片{alt ? `：${alt}` : ''}]</span> }}>{peekNote.content || '*空白页面*'}</ReactMarkdown></div></aside>}
    </section>
  </div>;
}
