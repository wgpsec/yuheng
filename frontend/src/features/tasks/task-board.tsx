import { Bell, CalendarDays, ChevronsRight, CircleDot, Flag, GripVertical, LayoutDashboard, Pencil, Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { CreateTaskInput, Task, TaskAsset, TaskPriority, TaskStatus, TaskType, UpdateTaskInput } from '../../contracts/desktop-bridge';
import { MarkdownBlockEditor } from './markdown-block-editor';
import { filterBoardTasks, type TaskFilter } from './task-filter';

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
  { value: 'open', label: '待办' },
  { value: 'due', label: '已到期' },
  { value: 'reminder', label: '待提醒' },
];

export function TaskBoard({ boardName, tasks, taskTypes, loading, headerControl, requestedOpenTaskId, onOpenTaskHandled, sourceConversations = [], onOpenConversation, onCreate, onUpdate, onCreateType, onRenameType, onImportAsset, onPickAssets, onOpenAsset }: {
  boardName: string;
  tasks: Task[];
  taskTypes: TaskType[];
  loading: boolean;
  headerControl?: ReactNode;
  requestedOpenTaskId?: string | null;
  onOpenTaskHandled?: () => void;
  sourceConversations?: { id: string; title: string }[];
  onOpenConversation?: (conversationId: string) => void;
  onCreate: (input: CreateTaskInput) => Promise<Task>;
  onUpdate: (id: string, patch: UpdateTaskInput) => Promise<Task>;
  onCreateType: (name: string) => Promise<TaskType>;
  onRenameType: (id: string, name: string) => Promise<TaskType>;
  onImportAsset: (file: File) => Promise<TaskAsset>;
  onPickAssets: () => Promise<TaskAsset[]>;
  onOpenAsset: (url: string) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(() => draftFor());
  const [editorSessionKey, setEditorSessionKey] = useState(0);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<TaskStatus | null>(null);
  const [editorWidth, setEditorWidth] = useState(480);
  const [resizingEditor, setResizingEditor] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [renamingTypeId, setRenamingTypeId] = useState<string | null>(null);
  const [renamingTypeName, setRenamingTypeName] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [error, setError] = useState<string | null>(null);
  const editingIdRef = useRef<string | 'new' | null>(null);
  const draftRef = useRef<Draft>(draft);
  const savedSignatureRef = useRef(draftSignature(draft));
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const mountedRef = useRef(true);
  const suppressCardClickRef = useRef<string | null>(null);
  const onCreateRef = useRef(onCreate);
  const onUpdateRef = useRef(onUpdate);
  onCreateRef.current = onCreate;
  onUpdateRef.current = onUpdate;

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

  const openNew = (status: TaskStatus = 'todo') => {
    clearScheduledSave();
    const next = draftFor(undefined, status);
    editingIdRef.current = 'new';
    draftRef.current = next;
    savedSignatureRef.current = draftSignature(next);
    setEditingId('new');
    setDraft(next);
    setEditorSessionKey((current) => current + 1);
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
  const openTask = (task: Task) => {
    clearScheduledSave();
    const next = draftFor(task);
    editingIdRef.current = task.id;
    draftRef.current = next;
    savedSignatureRef.current = draftSignature(next);
    setEditingId(task.id);
    setDraft(next);
    setEditorSessionKey((current) => current + 1);
    setError(null);
  };
  useEffect(() => {
    if (!requestedOpenTaskId || loading) return;
    const requested = tasks.find((task) => task.id === requestedOpenTaskId);
    if (!requested) return;
    openTask(requested);
    onOpenTaskHandled?.();
  }, [loading, requestedOpenTaskId, tasks]);
  const closeEditor = async () => {
    const saved = await enqueueSave(draftRef.current);
    if (!saved) return;
    editingIdRef.current = null;
    setEditingId(null);
    setError(null);
  };
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
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

  return <section className="task-page" aria-label="任务看板">
    <header className="task-page-header">
      {headerControl}
      <div><span className="task-page-kicker"><LayoutDashboard size={13} /> 看板</span><h1>{boardName}</h1><p>把需要推进的事项放到合适的阶段。</p></div>
      <div className="task-board-actions">
        <label className="task-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务" aria-label="搜索当前看板任务" />{query && <button type="button" onClick={() => setQuery('')} aria-label="清除任务搜索"><X size={13} /></button>}</label>
        <div className="task-filter" role="group" aria-label="筛选任务"><SlidersHorizontal size={14} /><select value={filter} onChange={(event) => setFilter(event.target.value as TaskFilter)} aria-label="任务筛选">{filters.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
        <button type="button" className="task-create-button" onClick={() => openNew(taskTypes[0]?.id)} disabled={taskTypes.length === 0}><Plus size={15} />新建任务</button>
      </div>
    </header>
    {error && !editingId && <div className="task-page-error" role="alert">{error}<button type="button" onClick={() => setError(null)} aria-label="关闭错误"><X size={14} /></button></div>}
    <div className="task-board-scroll">
      <div className="task-board" style={{ gridTemplateColumns: `${taskTypes.length > 0 ? `repeat(${taskTypes.length}, 260px) ` : ''}230px` }}>
        {taskTypes.map((taskType) => {
          const items = visibleTasks.filter((task) => task.status === taskType.id);
          return <section
            key={taskType.id}
            className={`task-column ${dropTarget === taskType.id ? 'is-drop-target' : ''}`}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(taskType.id); }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null); }}
            onDrop={(event) => void drop(event, taskType.id)}
          >
            <header className="task-column-header"><div><span className={`task-status-dot is-${taskType.id}`} />{renamingTypeId === taskType.id ? <input className="task-type-name-input" autoFocus value={renamingTypeName} onChange={(event) => setRenamingTypeName(event.target.value)} onBlur={() => void submitRenameType()} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { setRenamingTypeId(null); } }} aria-label="任务类型名称" /> : <><strong>{taskType.name}</strong><button type="button" className="task-type-rename" onClick={() => { setRenamingTypeId(taskType.id); setRenamingTypeName(taskType.name); }} aria-label={`修改${taskType.name}名称`} title="修改类型名称"><Pencil size={12} /></button></>}<span className="task-count">{items.length}</span></div><button type="button" onClick={() => openNew(taskType.id)} aria-label={`在${taskType.name}中新建任务`} title="新建任务"><Plus size={15} /></button></header>
            <p className="task-column-hint">{typeHints[taskType.id] ?? typeHints[taskType.id.split(':').at(-1) ?? ''] ?? '自定义任务类型'}</p>
            <div className="task-card-list">
              {loading && <div className="task-column-empty">正在读取...</div>}
              {!loading && items.length === 0 && (filtering ? <div className="task-column-empty">没有匹配任务</div> : <button type="button" className="task-column-empty" onClick={() => openNew(taskType.id)}>添加一项</button>)}
              {!loading && items.map((task) => <button
                type="button"
                key={task.id}
                className={`task-card ${draggedId === task.id ? 'is-dragging' : ''}`}
                draggable
                onPointerDown={() => { suppressCardClickRef.current = null; }}
                onClick={() => {
                  if (suppressCardClickRef.current === task.id) {
                    suppressCardClickRef.current = null;
                    return;
                  }
                  openTask(task);
                }}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/task-id', task.id);
                  suppressCardClickRef.current = task.id;
                  setDraggedId(task.id);
                }}
                onDragEnd={() => { setDraggedId(null); setDropTarget(null); }}
              >
                <span
                  className="task-card-grip"
                  aria-hidden="true"
                ><GripVertical size={13} /></span>
                <strong>{task.title}</strong>
                <span className="task-card-meta">
                  <span className={`task-priority is-${task.priority}`}>{priorities.find((item) => item.value === task.priority)?.label}优先级</span>
                  {task.dueAt && <span className="task-due"><CalendarDays size={12} />{dueLabel(task.dueAt)}</span>}
                  {task.remindAt && !task.reminderFiredAt && <span className="task-due"><Bell size={12} />{dateTimeLabel(task.remindAt)}</span>}
                  {task.reminderFiredAt && <span className="task-reminder-delivered"><Bell size={12} />已提醒</span>}
                </span>
              </button>)}
            </div>
          </section>;
        })}
        <section className="task-add-type" aria-label="添加任务类型"><Plus size={15} /><input value={newTypeName} onChange={(event) => setNewTypeName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void createType(); } }} placeholder="添加任务类型" aria-label="新任务类型名称" /><button type="button" onClick={() => void createType()} disabled={!newTypeName.trim()}>添加</button></section>
      </div>
    </div>
    {editingId && <>
      <button type="button" className="task-editor-backdrop" onClick={() => void closeEditor()} aria-label="关闭任务编辑器" />
      <aside className={`task-editor ${resizingEditor ? 'is-resizing' : ''}`} style={{ width: editorWidth }} aria-label={editingId === 'new' ? '新建任务' : '编辑任务'}>
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
    </>}
  </section>;
}
