import { Bell, Bookmark, CalendarDays, ChevronLeft, ChevronRight, ChevronsRight, CircleDot, Flag, GripVertical, LayoutDashboard, List, MoreHorizontal, Pencil, Plus, Search, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { CreateTaskInput, Task, TaskAsset, TaskPriority, TaskStatus, TaskType, UpdateTaskInput } from '../../contracts/desktop-bridge';
import { MarkdownBlockEditor } from './markdown-block-editor';
import { filterBoardTasks, type TaskFilter } from './task-filter';
import { calendarDays, tasksByDueDate, type TaskView } from './task-views';
import { ContextAiDrawer } from '../ai/context-ai-drawer';

const typeHints: Record<string, string> = {
  todo: '尚未开始',
  in_progress: '当前正在推进',
  done: '已经完成',
  archived: '暂不显示在日常计划中',
};

const priorities: { value: TaskPriority; label: string }[] = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
];

const editorMinWidth = 360;
const editorMaxWidth = 760;
const editorCloseDurationMs = 200;
export const TASK_EDITOR_WIDTH_STORAGE_KEY = 'yuheng-task-editor-width';
const SAVED_TASK_FILTERS_STORAGE_KEY = 'yuheng-task-saved-filters';
type SavedTaskFilter = { id: string; name: string; query: string; filter: TaskFilter };

function loadSavedTaskFilters(): SavedTaskFilter[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const value = JSON.parse(localStorage.getItem(SAVED_TASK_FILTERS_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is SavedTaskFilter => Boolean(item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.query === 'string' && ['all', 'open', 'due', 'reminder', 'today'].includes(item.filter)));
  } catch { return []; }
}

export function loadTaskEditorWidth(defaultWidth = 480): number {
  if (typeof localStorage === 'undefined') return defaultWidth;
  const parsed = Number(localStorage.getItem(TASK_EDITOR_WIDTH_STORAGE_KEY));
  return Number.isFinite(parsed) ? Math.max(editorMinWidth, Math.min(editorMaxWidth, Math.round(parsed))) : defaultWidth;
}

function editorWidthBounds(element: HTMLElement): { min: number; max: number } {
  const availableWidth = (element.closest<HTMLElement>('.task-page')?.getBoundingClientRect().width ?? window.innerWidth) - 72;
  const max = Math.max(280, Math.min(editorMaxWidth, availableWidth));
  return { min: Math.min(editorMinWidth, max), max };
}

type Draft = { title: string; description: string; status: TaskStatus; priority: TaskPriority; dueAt: string; remindAt: string };

function localDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const value = new Date(iso);
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function draftFor(task?: Task, status: TaskStatus = 'todo'): Draft {
  return { title: task?.title ?? '', description: task?.description ?? '', status: task?.status ?? status, priority: task?.priority ?? 'medium', dueAt: task?.dueAt ?? '', remindAt: localDateTime(task?.remindAt) };
}

function inputFor(draft: Draft): CreateTaskInput {
  return { title: draft.title, description: draft.description, status: draft.status, priority: draft.priority, dueAt: draft.dueAt || null, remindAt: draft.remindAt ? new Date(draft.remindAt).toISOString() : null };
}

function draftSignature(draft: Draft): string {
  return JSON.stringify(inputFor(draft));
}

function dueLabel(dueAt: string): string {
  const [year, month, day] = dueAt.split('-').map(Number);
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(year, month - 1, day));
}

function dateTimeLabel(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

const filters: { value: TaskFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'today', label: '今天' },
  { value: 'open', label: '待办' },
  { value: 'due', label: '已到期' },
  { value: 'reminder', label: '待提醒' },
];

const customColumnColors = ['#7c91b4', '#9b82ad', '#6f9b9a', '#b28b6f', '#8b92a8'];
const semanticColumnColors: Record<string, string> = {
  todo: '#d77d70',
  in_progress: '#d1a35b',
  done: '#719982',
  archived: '#8b7c72',
};

function columnColor(taskTypeId: string, index: number): string {
  return semanticColumnColors[taskTypeId] ?? customColumnColors[index % customColumnColors.length];
}

function taskDescriptionPreview(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '').trim())
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .split(/\r?\n/)
    .map((line) => line
      .replace(/^\s{0,3}[-*+]\s+\[([ xX]?)\]\s*/, (_match, checked: string) => checked.trim() ? '☑ ' : '☐ ')
      // Accept the compact checklist syntax commonly pasted from task notes.
      .replace(/(^|\s)\[([ xX]?)\]\s*/g, (_match, prefix: string, checked: string) => `${prefix}${checked.trim() ? '☑' : '☐'} `)
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/^\s{0,3}[-*+]\s+/, '• ')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/[*_`~]/g, '')
      .trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

export function TaskBoard({ boardId, boardName, boards, tasks, taskTypes, loading, headerControl, requestedOpenTaskId, onOpenTaskHandled, taskActionRequest, onTaskActionHandled, sourceConversations = [], onOpenConversation, onCreate, onUpdate, onDelete, onReorder, onMoveToBoard, onCopyToBoard, onCreateType, onRenameType, onDeleteType, onImportAsset, onPickAssets, onOpenAsset, onRunAi }: {
  boardId?: string;
  boardName: string;
  boards: { id: string; name: string }[];
  tasks: Task[];
  taskTypes: TaskType[];
  loading: boolean;
  headerControl?: ReactNode;
  requestedOpenTaskId?: string | null;
  onOpenTaskHandled?: () => void;
  taskActionRequest?: { kind: 'today' | 'quick_record'; id: number } | null;
  onTaskActionHandled?: () => void;
  sourceConversations?: { id: string; title: string }[];
  onOpenConversation?: (conversationId: string) => void;
  onCreate: (input: CreateTaskInput) => Promise<Task>;
  onUpdate: (id: string, patch: UpdateTaskInput) => Promise<Task>;
  onDelete: (id: string) => Promise<void>;
  onReorder: (id: string, targetId: string) => Promise<void>;
  onMoveToBoard: (id: string, boardId: string) => Promise<Task>;
  onCopyToBoard: (id: string, boardId: string) => Promise<Task>;
  onCreateType: (name: string) => Promise<TaskType>;
  onRenameType: (id: string, name: string) => Promise<TaskType>;
  onDeleteType: (id: string) => Promise<void>;
  onImportAsset: (file: File) => Promise<TaskAsset>;
  onPickAssets: () => Promise<TaskAsset[]>;
  onOpenAsset: (url: string) => Promise<void>;
  onRunAi?: (prompt: string, signal: AbortSignal) => Promise<string>;
}) {
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [editorClosing, setEditorClosing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftFor());
  const [editorSessionKey, setEditorSessionKey] = useState(0);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<TaskStatus | null>(null);
  const [dropTaskTarget, setDropTaskTarget] = useState<string | null>(null);
  const [editorWidth, setEditorWidth] = useState(() => loadTaskEditorWidth());
  const [resizingEditor, setResizingEditor] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [renamingTypeId, setRenamingTypeId] = useState<string | null>(null);
  const [renamingTypeName, setRenamingTypeName] = useState('');
  const [taskTypeMenuId, setTaskTypeMenuId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [view, setView] = useState<TaskView>('board');
  const [calendarMonth, setCalendarMonth] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1); });
  const [savedFilters, setSavedFilters] = useState<SavedTaskFilter[]>(loadSavedTaskFilters);
  const [taskMenuId, setTaskMenuId] = useState<string | null>(null);
  const [taskMenuClosingId, setTaskMenuClosingId] = useState<string | null>(null);
  const [boardAction, setBoardAction] = useState<'move' | 'copy' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editingIdRef = useRef<string | 'new' | null>(null);
  const draftRef = useRef<Draft>(draft);
  const savedSignatureRef = useRef(draftSignature(draft));
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const mountedRef = useRef(true);
  const editorSessionKeyRef = useRef(0);
  const editorCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taskMenuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorCloseRequestRef = useRef<number | null>(null);
  const suppressCardClickRef = useRef<string | null>(null);
  const onCreateRef = useRef(onCreate);
  const onUpdateRef = useRef(onUpdate);
  onCreateRef.current = onCreate;
  onUpdateRef.current = onUpdate;
  useEffect(() => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(TASK_EDITOR_WIDTH_STORAGE_KEY, String(Math.round(editorWidth)));
  }, [editorWidth]);

  const closeTaskMenu = () => {
    if (!taskMenuId) return;
    setTaskMenuClosingId(taskMenuId);
    setTaskMenuId(null);
    setBoardAction(null);
    if (taskMenuCloseTimerRef.current !== null) clearTimeout(taskMenuCloseTimerRef.current);
    taskMenuCloseTimerRef.current = setTimeout(() => { setTaskMenuClosingId(null); taskMenuCloseTimerRef.current = null; }, 125);
  };

  const clearScheduledSave = () => {
    if (saveTimerRef.current === null) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
  };
  const persistDraft = async (candidate: Draft): Promise<boolean> => {
    const currentEditingId = editingIdRef.current;
    const signature = draftSignature(candidate);
    if (!currentEditingId || signature === savedSignatureRef.current) return true;
    if (!candidate.title.trim()) {
      if (currentEditingId === 'new') return true;
      if (mountedRef.current) setError('任务名称不能为空。');
      return false;
    }
    try {
      if (currentEditingId === 'new') {
        const created = await onCreateRef.current(inputFor(candidate));
        editingIdRef.current = created.id;
        if (mountedRef.current) setEditingId((current) => current === 'new' ? created.id : current);
      } else {
        await onUpdateRef.current(currentEditingId, inputFor(candidate));
      }
      savedSignatureRef.current = signature;
      if (mountedRef.current) setError(null);
      return true;
    } catch (reason) {
      if (mountedRef.current) setError(reason instanceof Error ? reason.message : '自动保存任务失败。');
      return false;
    }
  };
  const enqueueSave = (candidate: Draft): Promise<boolean> => {
    clearScheduledSave();
    const job = saveQueueRef.current.then(() => persistDraft(candidate));
    saveQueueRef.current = job.catch(() => false);
    return job;
  };
  const scheduleSave = (candidate: Draft) => {
    clearScheduledSave();
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void enqueueSave(candidate);
    }, 450);
  };
  const updateDraft = (patch: Partial<Draft>) => {
    const next = { ...draftRef.current, ...patch };
    if (draftSignature(next) === draftSignature(draftRef.current)) return;
    draftRef.current = next;
    setDraft(next);
    scheduleSave(next);
  };

  const clearEditorCloseTimer = () => {
    if (editorCloseTimerRef.current === null) return;
    clearTimeout(editorCloseTimerRef.current);
    editorCloseTimerRef.current = null;
  };
  const nextEditorSession = () => {
    editorSessionKeyRef.current += 1;
    setEditorSessionKey(editorSessionKeyRef.current);
  };
  const finishEditorClose = (sessionKey: number) => {
    if (!mountedRef.current || editorSessionKeyRef.current !== sessionKey || !editingIdRef.current) return;
    clearEditorCloseTimer();
    editorCloseRequestRef.current = null;
    editingIdRef.current = null;
    setEditingId(null);
    setEditorClosing(false);
    setError(null);
  };
  const beginEditorClose = (sessionKey: number) => {
    if (!mountedRef.current || editorSessionKeyRef.current !== sessionKey || !editingIdRef.current) return;
    clearEditorCloseTimer();
    editorCloseRequestRef.current = sessionKey;
    setEditorClosing(true);
    editorCloseTimerRef.current = setTimeout(() => finishEditorClose(sessionKey), editorCloseDurationMs);
  };

  const openNew = (status: TaskStatus = 'todo') => {
    clearScheduledSave();
    clearEditorCloseTimer();
    editorCloseRequestRef.current = null;
    setEditorClosing(false);
    const next = draftFor(undefined, status);
    editingIdRef.current = 'new';
    draftRef.current = next;
    savedSignatureRef.current = draftSignature(next);
    setEditingId('new');
    setDraft(next);
    nextEditorSession();
    setError(null);
  };
  const createType = async () => {
    const name = newTypeName.trim();
    if (!name) return;
    try {
      await onCreateType(name);
      setNewTypeName('');
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '新建任务类型失败。');
    }
  };
  const submitRenameType = async () => {
    const id = renamingTypeId;
    const name = renamingTypeName.trim();
    setRenamingTypeId(null);
    if (!id || !name) return;
    try {
      await onRenameType(id, name);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '修改任务类型失败。');
    }
  };
  const deleteTaskType = async (taskType: TaskType, taskCount: number) => {
    setTaskTypeMenuId(null);
    if (taskTypes.length <= 1) {
      setError('至少保留一个任务类型。');
      return;
    }
    if (taskCount > 0) {
      setError('该类型仍有任务，请先移动或删除任务。');
      return;
    }
    if (!window.confirm(`删除任务类型“${taskType.name}”？此操作无法撤销。`)) return;
    try {
      await onDeleteType(taskType.id);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除任务类型失败。');
    }
  };
  const openTask = (task: Task) => {
    closeTaskMenu();
    clearScheduledSave();
    clearEditorCloseTimer();
    editorCloseRequestRef.current = null;
    setEditorClosing(false);
    const next = draftFor(task);
    editingIdRef.current = task.id;
    draftRef.current = next;
    savedSignatureRef.current = draftSignature(next);
    setEditingId(task.id);
    setDraft(next);
    nextEditorSession();
    setError(null);
  };
  useEffect(() => {
    if (!taskMenuId) return;
    const closeMenu = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest('.task-card-menu, .task-card-edit')) return;
      closeTaskMenu();
    };
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [taskMenuId]);
  useEffect(() => {
    if (!taskTypeMenuId) return;
    const closeMenu = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest('.task-type-menu, .task-type-menu-trigger')) return;
      setTaskTypeMenuId(null);
    };
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [taskTypeMenuId]);
  const deleteTask = async (task: Task) => {
    if (!window.confirm(`删除任务“${task.title}”？此操作无法撤销。`)) return;
    const editorSessionKey = editorSessionKeyRef.current;
    try {
      await onDelete(task.id);
      if (editingIdRef.current === task.id && editorSessionKeyRef.current === editorSessionKey) beginEditorClose(editorSessionKey);
      closeTaskMenu();
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除任务失败。');
    }
  };
  const moveOrCopyTask = async (task: Task, boardId: string) => {
    try {
      if (boardAction === 'move') await onMoveToBoard(task.id, boardId);
      else await onCopyToBoard(task.id, boardId);
      closeTaskMenu(); setError(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '操作任务失败。'); }
  };
  useEffect(() => {
    if (!requestedOpenTaskId || loading) return;
    const requested = tasks.find((task) => task.id === requestedOpenTaskId);
    if (!requested) return;
    openTask(requested);
    onOpenTaskHandled?.();
  }, [loading, requestedOpenTaskId, tasks]);
  useEffect(() => {
    const request = taskActionRequest;
    if (!request) return;
    if (request.kind === 'today') {
      setQuery('');
      setFilter('today');
      setView('list');
      onTaskActionHandled?.();
      return;
    }
    if (loading || taskTypes.length === 0) return;
    openNew(taskTypes[0].id);
    onTaskActionHandled?.();
  }, [loading, taskActionRequest, taskTypes]);
  const closeEditor = async () => {
    const sessionKey = editorSessionKeyRef.current;
    if (!editingIdRef.current || editorClosing || editorCloseRequestRef.current === sessionKey) return;
    editorCloseRequestRef.current = sessionKey;
    const saved = await enqueueSave(draftRef.current);
    if (!saved || !mountedRef.current || editorSessionKeyRef.current !== sessionKey) {
      if (editorCloseRequestRef.current === sessionKey) editorCloseRequestRef.current = null;
      return;
    }
    beginEditorClose(sessionKey);
  };
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearEditorCloseTimer();
      if (saveTimerRef.current !== null) void enqueueSave(draftRef.current);
    };
  }, []);
  const drop = async (event: DragEvent, status: TaskStatus) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/task-id') || draggedId;
    setDraggedId(null);
    setDropTarget(null);
    if (!taskId || tasks.find((task) => task.id === taskId)?.status === status) return;
    try {
      await onUpdate(taskId, { status });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '移动任务失败。');
    }
  };
  const dropOnTask = async (event: DragEvent, target: Task) => {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData('text/task-id') || draggedId;
    setDraggedId(null);
    setDropTaskTarget(null);
    if (!sourceId || sourceId === target.id) return;
    const source = tasks.find((task) => task.id === sourceId);
    if (!source) return;
    try {
      if (source.status !== target.status) await onUpdate(sourceId, { status: target.status });
      else await onReorder(sourceId, target.id);
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : '排序任务失败。'); }
  };
  const resizeEditor = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const { min, max } = editorWidthBounds(event.currentTarget);
    const parentRight = event.currentTarget.parentElement?.getBoundingClientRect().right ?? window.innerWidth;
    setEditorWidth(Math.max(min, Math.min(max, parentRight - event.clientX)));
  };
  const stopResizingEditor = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setResizingEditor(false);
  };
  const resizeEditorWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const { min, max } = editorWidthBounds(event.currentTarget);
    const delta = event.key === 'ArrowLeft' ? 24 : -24;
    setEditorWidth((current) => Math.max(min, Math.min(max, current + delta)));
  };

  const visibleTasks = filterBoardTasks(tasks, query, filter);
  const filtering = Boolean(query.trim()) || filter !== 'all';
  const editedTask = editingId && editingId !== 'new' ? tasks.find((task) => task.id === editingId) : undefined;
  const reminderWasDelivered = Boolean(editedTask?.reminderFiredAt && editedTask.remindAt === (draft.remindAt ? new Date(draft.remindAt).toISOString() : null));
  const dueTasks = tasksByDueDate(visibleTasks);
  const calendarGrid = calendarDays(calendarMonth);
  const changeStatus = async (task: Task, status: string) => {
    try { await onUpdate(task.id, { status }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '更新任务状态失败。'); }
  };
  const saveCurrentFilter = () => {
    const name = window.prompt('保存筛选名称', query.trim() || filters.find((item) => item.value === filter)?.label || '我的筛选')?.trim();
    if (!name) return;
    const saved = { id: crypto.randomUUID(), name, query, filter };
    const next = [...savedFilters.filter((item) => item.name !== name), saved].slice(-12);
    setSavedFilters(next);
    localStorage.setItem(SAVED_TASK_FILTERS_STORAGE_KEY, JSON.stringify(next));
  };
  const applySavedFilter = (id: string) => {
    const saved = savedFilters.find((item) => item.id === id);
    if (!saved) return;
    setQuery(saved.query); setFilter(saved.filter);
  };

  return <section
    className="task-page"
    aria-label="任务看板"
    onClick={(event) => {
      if (!editingId || editorClosing) return;
      const target = event.target as Element | null;
      if (target?.closest('.task-editor-layer, .task-card, button, input, select, textarea, a, [role="button"]')) return;
      void closeEditor();
    }}
  >
    <header key={`header:${boardId ?? 'empty-board'}`} className="task-page-header">
      {headerControl}
      <div><span className="task-page-kicker"><LayoutDashboard size={13} /> 看板</span><h1>{boardName}</h1><p>把需要推进的事项放到合适的阶段。</p></div>
      <div className="task-board-actions">
        <label className="task-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务" aria-label="搜索当前看板任务" />{query && <button type="button" onClick={() => setQuery('')} aria-label="清除任务搜索"><X size={13} /></button>}</label>
        <div className="task-filter" role="group" aria-label="筛选任务"><SlidersHorizontal size={14} /><select value={filter} onChange={(event) => setFilter(event.target.value as TaskFilter)} aria-label="任务筛选">{filters.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
        <div className="task-saved-filter" aria-label="已保存筛选"><Bookmark size={14} /><select defaultValue="" onChange={(event) => applySavedFilter(event.target.value)} aria-label="应用已保存筛选"><option value="">筛选</option>{savedFilters.map((saved) => <option key={saved.id} value={saved.id}>{saved.name}</option>)}</select><button type="button" onClick={saveCurrentFilter} aria-label="保存当前筛选" title="保存当前筛选"><Plus size={13} /></button></div>
        <div className="task-view-switcher" role="tablist" aria-label="任务视图">
          <button type="button" role="tab" aria-selected={view === 'board'} className={view === 'board' ? 'is-selected' : ''} onClick={() => setView('board')}><LayoutDashboard size={14} />看板</button>
          <button type="button" role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'is-selected' : ''} onClick={() => setView('list')}><List size={14} />列表</button>
          <button type="button" role="tab" aria-selected={view === 'calendar'} className={view === 'calendar' ? 'is-selected' : ''} onClick={() => setView('calendar')}><CalendarDays size={14} />日历</button>
        </div>
        <button type="button" className="task-create-button" onClick={() => openNew(taskTypes[0]?.id)} disabled={taskTypes.length === 0}><Plus size={15} />新建任务</button>
      </div>
    </header>
    {error && !editingId && <div className="task-page-error" role="alert">{error}<button type="button" onClick={() => setError(null)} aria-label="关闭错误"><X size={14} /></button></div>}
    <div key={`content:${boardId ?? 'empty-board'}:${view}`} className={`task-board-scroll task-view-${view}`}>
      {view === 'list' && <div className="task-list-view" role="table" aria-label="任务列表">
        <div className="task-list-header" role="row"><span>任务</span><span>状态</span><span>优先级</span><span>截止日期</span></div>
        {visibleTasks.length === 0 ? <div className="task-list-empty">{filtering ? '没有匹配任务' : '暂无任务'}</div> : visibleTasks.map((task) => <div className="task-list-row" role="row" key={task.id} onClick={() => openTask(task)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openTask(task); } }}>
          <div className="task-list-title"><strong>{task.title}</strong>{task.description && <small>{taskDescriptionPreview(task.description).split('\n')[0]}</small>}</div>
          <select value={task.status} aria-label={`${task.title}状态`} onClick={(event) => event.stopPropagation()} onChange={(event) => void changeStatus(task, event.target.value)}>{taskTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select>
          <span className={`task-list-priority is-${task.priority}`}>{priorities.find((item) => item.value === task.priority)?.label}</span>
          <span className="task-list-due">{task.dueAt ? dueLabel(task.dueAt) : '—'}</span>
        </div>)}
      </div>}
      {view === 'calendar' && <div className="task-calendar-view" aria-label="任务日历">
        <div className="task-calendar-toolbar"><button type="button" className="icon-button" onClick={() => setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))} aria-label="上个月"><ChevronLeft size={16} /></button><strong>{new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(calendarMonth)}</strong><button type="button" className="icon-button" onClick={() => setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))} aria-label="下个月"><ChevronRight size={16} /></button></div>
        <div className="task-calendar-weekdays" aria-hidden="true">{['日', '一', '二', '三', '四', '五', '六'].map((day) => <span key={day}>{day}</span>)}</div>
        <div className="task-calendar-grid">{calendarGrid.map((day) => <div className={`task-calendar-day ${day.inMonth ? '' : 'is-outside'}`} key={day.key}><time>{day.date.getDate()}</time><div>{(dueTasks.get(day.key) ?? []).map((task) => <button type="button" className="task-calendar-item" key={task.id} onClick={() => openTask(task)} title={task.title}><span className="task-status-dot" />{task.title}</button>)}</div></div>)}</div>
        {visibleTasks.length > 0 && dueTasks.size === 0 && <p className="task-calendar-empty">当前筛选结果没有设置截止日期的任务。</p>}
      </div>}
      {view === 'board' && <>
      <div className="task-board" style={{ gridTemplateColumns: `${taskTypes.length > 0 ? `repeat(${taskTypes.length}, 260px) ` : ''}230px` }}>
        {taskTypes.map((taskType, taskTypeIndex) => {
          const items = visibleTasks.filter((task) => task.status === taskType.id);
          const color = columnColor(taskType.id, taskTypeIndex);
          return <section
            key={taskType.id}
            className={`task-column ${dropTarget === taskType.id ? 'is-drop-target' : ''} ${taskTypeMenuId === taskType.id ? 'has-menu' : ''}`}
            style={{ '--task-column-color': color } as CSSProperties}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(taskType.id); }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null); }}
            onDrop={(event) => void drop(event, taskType.id)}
          >
            <header className="task-column-header"><div><span className={`task-status-dot is-${taskType.id}`} />{renamingTypeId === taskType.id ? <input className="task-type-name-input" autoFocus value={renamingTypeName} onChange={(event) => setRenamingTypeName(event.target.value)} onBlur={() => void submitRenameType()} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { setRenamingTypeId(null); } }} aria-label="任务类型名称" /> : <><strong>{taskType.name}</strong><button type="button" className="task-type-rename" onClick={() => { setRenamingTypeId(taskType.id); setRenamingTypeName(taskType.name); }} aria-label={`修改${taskType.name}名称`} title="修改类型名称"><Pencil size={12} /></button></>}<span className="task-count">{items.length}</span></div><div className="task-type-actions"><button type="button" className="task-type-menu-trigger" onClick={(event) => { event.stopPropagation(); setTaskTypeMenuId((current) => current === taskType.id ? null : taskType.id); }} aria-label={`打开${taskType.name}操作菜单`} aria-expanded={taskTypeMenuId === taskType.id} title="更多操作"><MoreHorizontal size={15} /></button>{taskTypeMenuId === taskType.id && <div className="task-type-menu" role="menu"><button type="button" role="menuitem" onClick={() => { setTaskTypeMenuId(null); setRenamingTypeId(taskType.id); setRenamingTypeName(taskType.name); }}><Pencil size={13} />重命名</button><button type="button" role="menuitem" className="is-destructive" onClick={() => void deleteTaskType(taskType, items.length)}><Trash2 size={13} />删除类型</button></div>}<button type="button" onClick={() => openNew(taskType.id)} aria-label={`在${taskType.name}中新建任务`} title="新建任务"><Plus size={15} /></button></div></header>
            <p className="task-column-hint">{typeHints[taskType.id] ?? typeHints[taskType.id.split(':').at(-1) ?? ''] ?? '自定义任务类型'}</p>
            <div className="task-card-list">
              {loading && <div className="task-column-empty">正在读取...</div>}
              {!loading && items.length === 0 && <div className="task-column-empty">{filtering ? '没有匹配任务' : '暂无任务'}</div>}
              {!loading && items.map((task) => {
                const preview = taskDescriptionPreview(task.description);
                const hasDescription = preview.length > 0;
                const hasMenu = taskMenuId === task.id || taskMenuClosingId === task.id;
                return <div key={task.id} className={`task-card-shell ${hasMenu ? 'has-menu' : ''}`}>
                <div
                role="button"
                tabIndex={0}
                className={`task-card ${hasDescription ? 'has-description' : 'is-compact'} ${draggedId === task.id ? 'is-dragging' : ''} ${dropTaskTarget === task.id ? 'is-drop-target' : ''}`}
                draggable
                onPointerDown={() => { suppressCardClickRef.current = null; }}
                onClick={() => {
                  if (suppressCardClickRef.current === task.id) {
                    suppressCardClickRef.current = null;
                    return;
                  }
                  openTask(task);
                }}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openTask(task); } }}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/task-id', task.id);
                  event.dataTransfer.setData('text/plain', task.id);
                  suppressCardClickRef.current = task.id;
                  setDraggedId(task.id);
                }}
                onDragOver={(event) => { const sourceId = event.dataTransfer.getData('text/task-id') || draggedId; const source = tasks.find((item) => item.id === sourceId); if (!source || source.status !== task.status || source.id === task.id) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTaskTarget(task.id); }}
                onDragLeave={() => setDropTaskTarget(null)}
                onDrop={(event) => { event.stopPropagation(); void dropOnTask(event, task); }}
                onDragEnd={() => { setDraggedId(null); setDropTarget(null); setDropTaskTarget(null); }}
                onContextMenu={(event) => { event.preventDefault(); if (taskMenuId === task.id) { closeTaskMenu(); return; } if (taskMenuCloseTimerRef.current !== null) clearTimeout(taskMenuCloseTimerRef.current); setTaskMenuClosingId(null); setBoardAction(null); setTaskMenuId(task.id); }}
              >
                <span
                  className="task-card-grip"
                  aria-hidden="true"
                ><GripVertical size={13} /></span>
                <button type="button" className="task-card-edit" onClick={(event) => { event.stopPropagation(); openTask(task); }} aria-label={`编辑${task.title}`} title="编辑"><Pencil size={13} /></button>
                {hasDescription && <span className="task-card-description">{preview}</span>}
                <div className="task-card-footer">
                  <strong>{task.title}</strong>
                  {hasDescription && (task.dueAt || task.remindAt || task.reminderFiredAt) && <span className="task-card-meta">
                    {task.dueAt && <span className="task-due"><CalendarDays size={12} />{dueLabel(task.dueAt)}</span>}
                    {task.remindAt && !task.reminderFiredAt && <span className="task-due"><Bell size={12} />{dateTimeLabel(task.remindAt)}</span>}
                    {task.reminderFiredAt && <span className="task-reminder-delivered"><Bell size={12} />已提醒</span>}
                  </span>}
                </div>
              </div>
              {hasMenu && <div className={`task-card-menu ${taskMenuClosingId === task.id ? 'is-closing' : ''}`}><button type="button" onClick={(event) => { event.stopPropagation(); openTask(task); }}><Pencil size={13} />编辑</button><button type="button" onClick={(event) => { event.stopPropagation(); setBoardAction('move'); }}><LayoutDashboard size={13} />移动到</button><button type="button" onClick={(event) => { event.stopPropagation(); setBoardAction('copy'); }}><LayoutDashboard size={13} />复制到</button>{boardAction && <div className="task-board-action-list">{boards.filter((board) => board.id !== (boardId ?? task.boardId)).map((board) => <button type="button" key={board.id} onClick={(event) => { event.stopPropagation(); void moveOrCopyTask(task, board.id); }}>{board.name}</button>)}</div>}<button type="button" className="is-destructive" onClick={(event) => { event.stopPropagation(); void deleteTask(task); }}><Trash2 size={13} />删除</button></div>}
              </div>;
              })}
            </div>
            {!loading && <button type="button" className="task-column-create" onClick={() => openNew(taskType.id)}><Plus size={15} aria-hidden="true" /><span>新建任务</span></button>}
          </section>;
        })}
        <section className="task-add-type" aria-label="添加任务类型"><Plus size={15} /><input value={newTypeName} onChange={(event) => setNewTypeName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void createType(); } }} placeholder="添加任务类型" aria-label="新任务类型名称" /><button type="button" onClick={() => void createType()} disabled={!newTypeName.trim()}>添加</button></section>
      </div>
      </>}
    </div>
    {onRunAi && <ContextAiDrawer sourceLabel={`“${boardName}”看板`} onSend={onRunAi} />}
    {editingId && <div className="task-editor-layer">
      <button type="button" tabIndex={-1} aria-hidden="true" className={`task-editor-backdrop ${editorClosing ? 'is-closing' : ''}`} />
      <aside className={`task-editor ${resizingEditor ? 'is-resizing' : ''} ${editorClosing ? 'is-closing' : ''}`} style={{ width: editorWidth }} aria-label={editingId === 'new' ? '新建任务' : '编辑任务'} onAnimationEnd={(event) => { if (editorClosing && event.currentTarget === event.target && event.animationName === 'task-editor-slide-out') finishEditorClose(editorSessionKeyRef.current); }}>
      <div
        className="task-editor-resize-handle"
        role="separator"
        aria-label="调整任务编辑器宽度"
        aria-orientation="vertical"
        aria-valuemin={editorMinWidth}
        aria-valuemax={editorMaxWidth}
        aria-valuenow={editorWidth}
        tabIndex={0}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          setResizingEditor(true);
        }}
        onPointerMove={resizeEditor}
        onPointerUp={stopResizingEditor}
        onPointerCancel={stopResizingEditor}
        onKeyDown={resizeEditorWithKeyboard}
      />
      <button type="button" className="task-editor-close" onClick={() => void closeEditor()} aria-label="关闭任务编辑器" title="关闭"><ChevronsRight size={19} /></button>
      <form onSubmit={(event) => event.preventDefault()}>
        <div className="task-title-field"><input autoFocus value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} onBlur={() => void enqueueSave(draftRef.current)} placeholder="无标题任务" aria-label="任务名称" required /></div>
        <div className="task-properties" aria-label="任务属性">
          <label className="task-property-row"><span><CircleDot size={15} />任务类型</span><select value={draft.status} onChange={(event) => updateDraft({ status: event.target.value })}>{taskTypes.map((taskType) => <option key={taskType.id} value={taskType.id}>{taskType.name}</option>)}</select></label>
          <label className="task-property-row"><span><Flag size={15} />优先级</span><select value={draft.priority} onChange={(event) => updateDraft({ priority: event.target.value as TaskPriority })}>{priorities.map((priority) => <option key={priority.value} value={priority.value}>{priority.label}</option>)}</select></label>
          <label className="task-property-row"><span><CalendarDays size={15} />截止日期</span><input type="date" value={draft.dueAt} onChange={(event) => updateDraft({ dueAt: event.target.value })} /></label>
          <label className="task-property-row"><span><Bell size={15} />提醒时间</span><span className="task-reminder-input"><input type="datetime-local" value={draft.remindAt} onChange={(event) => updateDraft({ remindAt: event.target.value })} />{draft.remindAt && <button type="button" onClick={() => updateDraft({ remindAt: '' })} aria-label="清除提醒时间" title="清除提醒"><X size={13} /></button>}</span></label>
          {reminderWasDelivered && editedTask?.reminderFiredAt && <div className="task-property-row task-reminder-state"><span><Bell size={15} />提醒状态</span><span>已于 {dateTimeLabel(editedTask.reminderFiredAt)} 发送</span></div>}
          {editingId !== 'new' && editingId && (() => {
            const sourceId = tasks.find((task) => task.id === editingId)?.sourceConversationId;
            if (!sourceId) return null;
            const source = sourceConversations.find((conversation) => conversation.id === sourceId);
            return <div className="task-property-row task-source-row"><span>来源会话</span>{source && onOpenConversation ? <button type="button" className="task-source-link" onClick={() => onOpenConversation(sourceId)}>{source.title}</button> : <span className="task-source-missing">来源会话已不存在</span>}</div>;
          })()}
        </div>
        <div className="task-description-field">
          <MarkdownBlockEditor key={editorSessionKey} value={draft.description} onChange={(description) => updateDraft({ description })} onImportAsset={onImportAsset} onPickAssets={onPickAssets} onOpenAsset={onOpenAsset} />
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
      </form>
      </aside>
    </div>}
  </section>;
}
