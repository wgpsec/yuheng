import { BrowserWindow, dialog, shell, type OpenDialogOptions } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { MAX_TASK_ASSET_BYTES, type TaskAsset, type TaskAssetStore } from '../task-assets';
import type { AppStore, CreateTaskInput, Task, TaskBoard, TaskPriority, TaskStatus, TaskType, UpdateTaskInput } from '../store';
import { assertText } from './ipc-input';
import type { DomainIpcRegistrar } from './secured-ipc-registrar';

type TaskStore = Pick<AppStore,
  | 'listTaskBoards' | 'createTaskBoard' | 'renameTaskBoard' | 'reorderTaskBoards' | 'deleteTaskBoard'
  | 'listTasks' | 'listTaskTypes' | 'createTaskType' | 'renameTaskType' | 'deleteTaskType'
  | 'createTask' | 'updateTask' | 'reorderTask' | 'moveTaskToBoard' | 'copyTaskToBoard' | 'deleteTask'
>;

export type TaskIpcDependencies = {
  registrar: DomainIpcRegistrar;
  store: TaskStore;
  assets: TaskAssetStore;
  takePendingOpen(): { boardId: string; taskId: string } | null;
  taskChanged(task: Task): void;
  taskTypesChanged(boardId: string): void;
  taskBoardsChanged(): void;
  attachmentMimeType(name: string): string;
};

const MAX_TOTAL_ASSET_BYTES = 20 * 1024 * 1024;

function taskStatus(value: unknown, optional = false): TaskStatus | undefined {
  if (optional && value === undefined) return undefined;
  return assertText(value, 'status');
}

function taskTypeName(value: unknown): string {
  const name = assertText(value, 'task type name');
  if (name.length > 80) throw new Error('Task type name must be 80 characters or fewer.');
  return name;
}

function taskBoardName(value: unknown): string {
  const name = assertText(value, 'task board name');
  if (name.length > 80) throw new Error('Task board name must be 80 characters or fewer.');
  return name;
}

function taskPriority(value: unknown, optional = false): TaskPriority | undefined {
  if (optional && value === undefined) return undefined;
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  throw new Error('Unsupported task priority.');
}

function taskDueAt(value: unknown, optional = false): string | null | undefined {
  if (optional && value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00`))) return value;
  throw new Error('Task due date must use YYYY-MM-DD.');
}

function taskRemindAt(value: unknown, optional = false): string | null | undefined {
  if (optional && value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) return new Date(timestamp).toISOString();
  }
  throw new Error('Task reminder must use an ISO 8601 date and time.');
}

function taskInput(raw: unknown): CreateTaskInput {
  if (!raw || typeof raw !== 'object') throw new Error('Task input is required.');
  const input = raw as Record<string, unknown>;
  return {
    title: assertText(input.title, 'title'),
    description: typeof input.description === 'string' ? input.description : '',
    status: taskStatus(input.status, true),
    priority: taskPriority(input.priority ?? 'medium'),
    dueAt: taskDueAt(input.dueAt ?? null),
    remindAt: taskRemindAt(input.remindAt ?? null),
    sourceConversationId: input.sourceConversationId == null ? null : assertText(input.sourceConversationId, 'sourceConversationId'),
  };
}

function taskPatch(raw: unknown): UpdateTaskInput {
  if (!raw || typeof raw !== 'object') throw new Error('Task patch is required.');
  const input = raw as Record<string, unknown>;
  const patch: UpdateTaskInput = {};
  if ('title' in input) patch.title = assertText(input.title, 'title');
  if ('description' in input) {
    if (typeof input.description !== 'string') throw new Error('Task description must be text.');
    patch.description = input.description;
  }
  if ('status' in input) patch.status = taskStatus(input.status, true);
  if ('priority' in input) patch.priority = taskPriority(input.priority, true);
  if ('dueAt' in input) patch.dueAt = taskDueAt(input.dueAt, true);
  if ('remindAt' in input) patch.remindAt = taskRemindAt(input.remindAt, true);
  return patch;
}

function taskAssetData(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error('Attachment data is required.');
}

export function registerTaskIpc(dependencies: TaskIpcDependencies): void {
  const { registrar, store } = dependencies;
  const importAsset = (raw: unknown): Promise<TaskAsset> => {
    if (!raw || typeof raw !== 'object') throw new Error('Attachment input is required.');
    const input = raw as Record<string, unknown>;
    const name = assertText(input.name, 'name');
    const mimeType = typeof input.mimeType === 'string' && input.mimeType.trim() ? input.mimeType.trim() : dependencies.attachmentMimeType(name);
    return dependencies.assets.import(name, mimeType, taskAssetData(input.data));
  };

  registrar.main('tasks:boards:list', (): TaskBoard[] => store.listTaskBoards());
  registrar.main('tasks:boards:create', (_event, rawName: unknown): TaskBoard => {
    const board = store.createTaskBoard(taskBoardName(rawName)); dependencies.taskBoardsChanged(); return board;
  });
  registrar.main('tasks:boards:rename', (_event, boardId: unknown, rawName: unknown): TaskBoard => {
    const board = store.renameTaskBoard(assertText(boardId, 'boardId'), taskBoardName(rawName)); dependencies.taskBoardsChanged(); return board;
  });
  registrar.main('tasks:boards:reorder', (_event, boardId: unknown, targetBoardId: unknown): TaskBoard[] => {
    const boards = store.reorderTaskBoards(assertText(boardId, 'boardId'), assertText(targetBoardId, 'targetBoardId')); dependencies.taskBoardsChanged(); return boards;
  });
  registrar.main('tasks:boards:delete', (_event, boardId: unknown, replacementBoardId: unknown) => {
    store.deleteTaskBoard(assertText(boardId, 'boardId'), typeof replacementBoardId === 'string' ? replacementBoardId.trim() : '');
    dependencies.taskBoardsChanged();
  });
  registrar.main('tasks:list', (_event, boardId: unknown) => store.listTasks(assertText(boardId, 'boardId')));
  registrar.main('tasks:open-request:take', () => dependencies.takePendingOpen());
  registrar.main('tasks:types:list', (_event, boardId: unknown): TaskType[] => store.listTaskTypes(assertText(boardId, 'boardId')));
  registrar.main('tasks:types:create', (_event, boardId: unknown, rawName: unknown): TaskType => {
    const type = store.createTaskType(taskTypeName(rawName), assertText(boardId, 'boardId')); dependencies.taskTypesChanged(type.boardId); return type;
  });
  registrar.main('tasks:types:rename', (_event, taskTypeId: unknown, rawName: unknown): TaskType => {
    const type = store.renameTaskType(assertText(taskTypeId, 'taskTypeId'), taskTypeName(rawName)); dependencies.taskTypesChanged(type.boardId); return type;
  });
  registrar.main('tasks:types:delete', (_event, taskTypeId: unknown) => {
    const type = store.deleteTaskType(assertText(taskTypeId, 'taskTypeId')); dependencies.taskTypesChanged(type.boardId);
  });
  registrar.main('tasks:create', (_event, boardId: unknown, raw: unknown) => {
    const task = store.createTask(taskInput(raw), assertText(boardId, 'boardId')); dependencies.taskChanged(task); return task;
  });
  registrar.main('tasks:update', (_event, taskId: unknown, raw: unknown) => {
    const task = store.updateTask(assertText(taskId, 'taskId'), taskPatch(raw)); dependencies.taskChanged(task); return task;
  });
  registrar.main('tasks:reorder', (_event, taskId: unknown, targetTaskId: unknown) => {
    const tasks = store.reorderTask(assertText(taskId, 'taskId'), assertText(targetTaskId, 'targetTaskId')); dependencies.taskBoardsChanged(); return tasks;
  });
  registrar.main('tasks:move-board', (_event, taskId: unknown, boardId: unknown) => {
    const task = store.moveTaskToBoard(assertText(taskId, 'taskId'), assertText(boardId, 'boardId')); dependencies.taskChanged(task); return task;
  });
  registrar.main('tasks:copy-board', (_event, taskId: unknown, boardId: unknown) => {
    const task = store.copyTaskToBoard(assertText(taskId, 'taskId'), assertText(boardId, 'boardId')); dependencies.taskChanged(task); return task;
  });
  registrar.main('tasks:delete', (_event, taskId: unknown) => { store.deleteTask(assertText(taskId, 'taskId')); dependencies.taskBoardsChanged(); });
  registrar.main('tasks:assets:import', (_event, raw: unknown) => importAsset(raw));
  registrar.main('tasks:assets:pick', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = { properties: ['openFile', 'multiSelections'] };
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (result.canceled) return [];
    let totalBytes = 0;
    for (const filePath of result.filePaths) {
      const size = (await fs.stat(filePath)).size;
      if (size > MAX_TASK_ASSET_BYTES) throw new Error(`附件超过 10 MB：${path.basename(filePath)}`);
      totalBytes += size;
      if (totalBytes > MAX_TOTAL_ASSET_BYTES) throw new Error('单次添加的附件总大小不能超过 20 MB。');
    }
    const imported: TaskAsset[] = [];
    for (const filePath of result.filePaths) imported.push(await dependencies.assets.import(path.basename(filePath), dependencies.attachmentMimeType(filePath), await fs.readFile(filePath)));
    return imported;
  });
  registrar.main('tasks:assets:open', async (_event, rawUrl: unknown) => {
    const error = await shell.openPath(dependencies.assets.resolveUrl(assertText(rawUrl, 'assetUrl')));
    if (error) throw new Error(error);
  });
}
