import type { CreateTaskInput, Task, TaskBoard, TaskPriority, TaskType, UpdateTaskInput } from './store';

export const TASK_TOOL_NAMES = ['task_list', 'task_create', 'task_update'] as const;
export type TaskToolName = typeof TASK_TOOL_NAMES[number];

export type TaskToolService = {
  listBoards: () => TaskBoard[];
  listTypes: (boardId: string) => TaskType[];
  listTasks: (boardId: string) => Task[];
  createTask: (boardId: string, input: CreateTaskInput) => Task;
  updateTask: (taskId: string, patch: UpdateTaskInput) => Task;
  taskChanged: (task: Task) => void;
};

type TaskListResult = { boards: TaskBoard[]; types: TaskType[]; tasks: Task[] };
type TaskMutationResult = { task: Task };

function text(args: Record<string, unknown>, key: string, required = false): string | undefined {
  const value = args[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} 不能为空。`);
  return value.trim();
}

function priority(value: unknown): TaskPriority | undefined {
  if (value === undefined) return undefined;
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  throw new Error('priority 必须是 low、medium 或 high。');
}

function dueDate(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00`))) return value;
  throw new Error('due_date 必须使用 YYYY-MM-DD 格式，传 null 可清除。');
}

function reminderDateTime(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) return new Date(timestamp).toISOString();
  }
  throw new Error('remind_at 必须是 ISO 8601 日期时间；未带时区时使用当前 Mac 时区，传 null 可清除。');
}

export function executeTaskTool(service: TaskToolService, conversationId: string, name: 'task_list', args: Record<string, unknown>): Promise<TaskListResult>;
export function executeTaskTool(service: TaskToolService, conversationId: string, name: 'task_create' | 'task_update', args: Record<string, unknown>): Promise<TaskMutationResult>;
export function executeTaskTool(service: TaskToolService, conversationId: string, name: TaskToolName, args: Record<string, unknown>): Promise<TaskListResult | TaskMutationResult>;
export async function executeTaskTool(service: TaskToolService, conversationId: string, name: TaskToolName, args: Record<string, unknown>): Promise<TaskListResult | TaskMutationResult> {
  if (name === 'task_list') {
    const boards = service.listBoards();
    const boardId = text(args, 'board_id');
    if (!boardId) return { boards, types: [], tasks: [] };
    if (!boards.some((board) => board.id === boardId)) throw new Error('找不到指定的任务看板。请先调用 task_list 获取有效 board_id。');
    return { boards, types: service.listTypes(boardId), tasks: service.listTasks(boardId) };
  }

  if (name === 'task_create') {
    const boardId = text(args, 'board_id', true)!;
    const task = service.createTask(boardId, {
      title: text(args, 'title', true)!,
      description: typeof args.description === 'string' ? args.description : '',
      status: text(args, 'type_id'),
      priority: priority(args.priority),
      dueAt: dueDate(args.due_date),
      remindAt: reminderDateTime(args.remind_at),
      sourceConversationId: conversationId,
    });
    service.taskChanged(task);
    return { task };
  }

  const taskId = text(args, 'task_id', true)!;
  const patch: UpdateTaskInput = {};
  if ('title' in args) patch.title = text(args, 'title', true)!;
  if ('description' in args) {
    if (typeof args.description !== 'string') throw new Error('description 必须是文本。');
    patch.description = args.description;
  }
  if ('type_id' in args) patch.status = text(args, 'type_id', true)!;
  if ('priority' in args) patch.priority = priority(args.priority);
  if ('due_date' in args) patch.dueAt = dueDate(args.due_date);
  if ('remind_at' in args) patch.remindAt = reminderDateTime(args.remind_at);
  if (Object.keys(patch).length === 0) throw new Error('至少提供一个要修改的字段。');
  const task = service.updateTask(taskId, patch);
  service.taskChanged(task);
  return { task };
}
