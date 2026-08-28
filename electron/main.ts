import { app, BrowserWindow, dialog, ipcMain, net, Notification, protocol, screen, shell, type OpenDialogOptions, type Rectangle, type WebContents } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AppStore, type BrowserUseConfig, type ComputerUseConfig, type ConversationProject, type CreateTaskInput, type ProviderConfig, type ReasoningSelection, type RunUsage, type Task, type TaskBoard, type TaskPriority, type TaskStatus, type TaskType, type UpdateTaskInput } from './store';
import { SecretStore } from './secrets';
import { createPiRuntime, createPiSessionFactory, type ReasoningLevel } from './pi-runtime';
import { loadYuhengSystemPrompt } from './system-prompt';
import { MAX_TASK_ASSET_BYTES, TASK_ASSET_SCHEME, TaskAssetStore, type TaskAsset } from './task-assets';
import { BrowserUseSupervisor, redactBrowserToolInput, type BrowserToolName } from './browser-use';
import { TaskReminderScheduler } from './task-reminders';
import { BROWSER_ARTIFACT_SCHEME, BrowserArtifactStore, browserImagesFromToolResult, type BrowserArtifact } from './browser-artifacts';
import { ComputerUseLease, redactComputerUseToolInput, type ComputerUseToolName } from './computer-use';

protocol.registerSchemesAsPrivileged([
  { scheme: TASK_ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: BROWSER_ARTIFACT_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const isDevelopment = Boolean(process.env.ELECTRON_RENDERER_URL);
let store: AppStore;
let secrets: SecretStore;
let taskAssets: TaskAssetStore;
let browserUse: BrowserUseSupervisor;
let browserArtifacts: BrowserArtifactStore;
const computerUseLease = new ComputerUseLease();
let taskReminders: TaskReminderScheduler;
let pendingTaskOpen: { boardId: string; taskId: string } | null = null;
const activeRuns = new Map<string, { controller: AbortController; conversationId: string; inputMessageId: string; replayUser?: { ordinal: number; content: string } }>();
const pendingApprovals = new Map<string, { runId: string; senderId: number; finish: (approved: boolean) => void }>();
type StoredAttachment = Attachment & { data: Uint8Array };
type Attachment = { id: string; name: string; mimeType: string; size: number };
const attachments = new Map<string, StoredAttachment>();
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const allowedAttachmentTypes: Record<string, string> = {
  '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json',
  '.js': 'text/javascript', '.ts': 'text/typescript', '.py': 'text/x-python', '.html': 'text/html', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
};

function attachmentMimeType(name: string): string {
  return allowedAttachmentTypes[path.extname(name).toLowerCase()] ?? 'application/octet-stream';
}

const DEFAULT_WINDOW_BOUNDS: Rectangle = { x: 0, y: 0, width: 1440, height: 920 };
const MIN_WINDOW_WIDTH = 980;
const MIN_WINDOW_HEIGHT = 640;
const WINDOW_STATE_FILE = 'window-state.json';

function windowStatePath(): string {
  return path.join(app.getPath('userData'), WINDOW_STATE_FILE);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function loadWindowBounds(): Partial<Rectangle> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(windowStatePath(), 'utf8'));
    if (!parsed || typeof parsed !== 'object') return undefined;
    const state = parsed as Record<string, unknown>;
    const bounds: Partial<Rectangle> = {};
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      const value = finiteNumber(state[key]);
      if (value !== undefined) bounds[key] = Math.round(value);
    }
    if (bounds.width === undefined || bounds.height === undefined) return undefined;
    return bounds;
  } catch {
    return undefined;
  }
}

function visibleWindowBounds(saved: Partial<Rectangle> | undefined): Rectangle {
  const displays = screen.getAllDisplays();
  const display = saved?.x !== undefined && saved?.y !== undefined
    ? displays.find((candidate) => saved.x! >= candidate.bounds.x
      && saved.x! < candidate.bounds.x + candidate.bounds.width
      && saved.y! >= candidate.bounds.y
      && saved.y! < candidate.bounds.y + candidate.bounds.height) ?? screen.getPrimaryDisplay()
    : screen.getPrimaryDisplay();
  const workArea = display.workArea;
  const width = Math.min(Math.max(saved?.width ?? DEFAULT_WINDOW_BOUNDS.width, MIN_WINDOW_WIDTH), workArea.width);
  const height = Math.min(Math.max(saved?.height ?? DEFAULT_WINDOW_BOUNDS.height, MIN_WINDOW_HEIGHT), workArea.height);
  const x = saved?.x ?? workArea.x + Math.round((workArea.width - width) / 2);
  const y = saved?.y ?? workArea.y + Math.round((workArea.height - height) / 2);
  return {
    x: Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - width),
    y: Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - height),
    width,
    height,
  };
}

function saveWindowBounds(window: BrowserWindow): void {
  if (window.isDestroyed() || window.isMaximized() || window.isFullScreen()) return;
  const bounds = window.getBounds();
  const filePath = windowStatePath();
  const temporaryPath = `${filePath}.tmp`;
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(temporaryPath, JSON.stringify({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }), 'utf8');
    renameSync(temporaryPath, filePath);
  } catch {
    // Window preferences are best effort and must not prevent the app from closing.
  }
}

type RunEvent =
  | { type: 'accepted'; runId: string; conversationId: string }
  | { type: 'delta'; runId: string; conversationId: string; messageId: string; delta: string; createdAt: string }
  | { type: 'tool_start'; runId: string; conversationId: string; toolCallId: string; toolName: string; input?: string }
  | { type: 'tool_end'; runId: string; conversationId: string; toolCallId: string; toolName: string; isError: boolean; output?: string; artifacts: BrowserArtifact[] }
  | { type: 'approval_required'; runId: string; conversationId: string; approvalId: string; toolCallId: string; toolName: string; input?: string }
  | { type: 'approval_resolved'; runId: string; conversationId: string; approvalId: string; approved: boolean }
  | { type: 'completed'; runId: string; conversationId: string; messageId: string }
  | { type: 'failed'; runId: string; conversationId: string; error: string }
  | { type: 'cancelled'; runId: string; conversationId: string };

function assertText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function emit(sender: WebContents, event: RunEvent): void {
  if (!sender.isDestroyed()) sender.send('run:event', event);
}

function emitTaskChanged(task: Task): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('task:event', { type: 'changed', task });
  }
}

function handleTaskChanged(task: Task): void {
  emitTaskChanged(task);
  taskReminders?.refresh();
}

function emitTaskTypesChanged(boardId: string): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('task:event', { type: 'types_changed', boardId });
  }
}

function emitTaskBoardsChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('task:event', { type: 'boards_changed' });
  }
}

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
  const sourceConversationId = input.sourceConversationId == null ? null : assertText(input.sourceConversationId, 'sourceConversationId');
  return {
    title: assertText(input.title, 'title'),
    description: typeof input.description === 'string' ? input.description : '',
    status: taskStatus(input.status, true),
    priority: taskPriority(input.priority ?? 'medium'),
    dueAt: taskDueAt(input.dueAt ?? null),
    remindAt: taskRemindAt(input.remindAt ?? null),
    sourceConversationId,
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

async function importTaskAsset(raw: unknown): Promise<TaskAsset> {
  if (!raw || typeof raw !== 'object') throw new Error('Attachment input is required.');
  const input = raw as Record<string, unknown>;
  const name = assertText(input.name, 'name');
  const mimeType = typeof input.mimeType === 'string' && input.mimeType.trim() ? input.mimeType.trim() : attachmentMimeType(name);
  return taskAssets.import(name, mimeType, taskAssetData(input.data));
}

function summarizeToolValue(value: unknown, maxLength = 400): string | undefined {
  if (value == null) return undefined;
  const text = typeof value === 'string' ? value : (() => {
    try {
      return JSON.stringify(value, (key, item: unknown) => {
        if (key === 'data' && typeof item === 'string' && item.length > 160) return `<omitted:${item.length} characters>`;
        return item;
      });
    } catch { return String(value); }
  })();
  const trimmed = text.trim();
  return trimmed ? (trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed) : undefined;
}

function requestToolApproval(sender: WebContents, runId: string, conversationId: string, toolCallId: string, toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted || sender.isDestroyed()) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const approvalId = crypto.randomUUID();
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(false), 120_000);
    const finish = (approved: boolean) => {
      if (!pendingApprovals.has(approvalId)) return;
      pendingApprovals.delete(approvalId);
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      emit(sender, { type: 'approval_resolved', runId, conversationId, approvalId, approved });
      resolve(approved);
    };
    pendingApprovals.set(approvalId, { runId, senderId: sender.id, finish });
    signal?.addEventListener('abort', onAbort, { once: true });
    emit(sender, {
      type: 'approval_required',
      runId,
      conversationId,
      approvalId,
      toolCallId,
      toolName,
      input: summarizeToolValue(toolName.startsWith('browser_') ? redactBrowserToolInput(toolName, args) : redactComputerUseToolInput(toolName, args)),
    });
  });
}

async function executeRun(sender: WebContents, runId: string, conversationId: string, config: ProviderConfig, apiKey: string, runAttachments: StoredAttachment[], reasoningLevel?: ReasoningLevel): Promise<void> {
  const run = activeRuns.get(runId);
  if (!run) return;
  const assistantMessageId = crypto.randomUUID();
  let assistantCreated = false;
  let assistantCreatedAt: string | null = null;
  let assistantContent = '';
  let runUsage: RunUsage | undefined;
  const browserUseConfig = store.getBrowserUseConfig();
  const computerUseConfig = store.getComputerUseConfig();
  let releaseComputerUse: (() => void) | undefined;
  let runtime: ReturnType<typeof createPiRuntime> | undefined;
  try {
    if (computerUseConfig.enabled) releaseComputerUse = await computerUseLease.acquire(run.controller.signal);
    runtime = createPiRuntime({ sessionFactory: createPiSessionFactory(config, apiKey, {
    agentDir: path.join(app.getPath('userData'), 'pi-agent'),
    yuhengSystemPrompt: loadYuhengSystemPrompt(app.getAppPath()),
    thinkingLevel: reasoningLevel,
    taskService: {
      listBoards: () => store.listTaskBoards(),
      listTypes: (boardId) => store.listTaskTypes(boardId),
      listTasks: (boardId) => store.listTasks(boardId),
      createTask: (boardId, input) => store.createTask(input, boardId),
      updateTask: (taskId, patch) => store.updateTask(taskId, patch),
      taskChanged: handleTaskChanged,
    },
    browserUse: browserUseConfig.enabled ? {
      supervisor: browserUse,
      requestApproval: (toolCallId, toolName, args, signal) => requestToolApproval(sender, runId, conversationId, toolCallId, toolName, args, signal),
    } : undefined,
    computerUse: computerUseConfig.enabled ? {
      requestApproval: (toolCallId, toolName, args, signal) => requestToolApproval(sender, runId, conversationId, toolCallId, toolName, args, signal),
    } : undefined,
  }) });
    const workspaceDir = path.join(app.getPath('userData'), 'workspace');
    await fs.mkdir(workspaceDir, { recursive: true });
    const messages = store.listMessages(conversationId);
    const inputIndex = messages.findIndex((message) => message.id === run.inputMessageId);
    if (inputIndex < 0 || messages[inputIndex].role !== 'user') throw new Error('运行输入消息已不存在。');
    const prompt = messages[inputIndex].content;
    const images = runAttachments.filter((attachment) => attachment.mimeType.startsWith('image/')).map((attachment) => ({ type: 'image' as const, data: Buffer.from(attachment.data).toString('base64'), mimeType: attachment.mimeType }));
    const textAttachments = runAttachments.filter((attachment) => !attachment.mimeType.startsWith('image/')).map((attachment) => `\n[附件：${attachment.name}]\n${Buffer.from(attachment.data).toString('utf8')}\n[/附件]`).join('');
    await runtime.start({
      prompt: `${prompt || '请查看附件并回复。'}${textAttachments}`,
      images,
      sessionId: conversationId,
      cwd: workspaceDir,
      history: messages.slice(0, inputIndex).map(({ role, content, createdAt }) => ({ role, content, createdAt })),
      replayUser: run.replayUser,
      signal: run.controller.signal,
      emit: (event) => {
        if (event.type === 'tool_start') {
          const input = summarizeToolValue(event.toolName.startsWith('browser_') ? redactBrowserToolInput(event.toolName, event.args) : redactComputerUseToolInput(event.toolName, event.args));
          store.startToolActivity(runId, event.toolCallId, event.toolName, input);
          emit(sender, { type: 'tool_start', runId, conversationId, toolCallId: event.toolCallId, toolName: event.toolName, input });
          return;
        }
        if (event.type === 'tool_end') {
          const output = summarizeToolValue(event.result);
          const artifactKind = event.toolName.startsWith('browser_') ? 'browser_screenshot' : 'computer_screenshot';
          const artifacts = browserImagesFromToolResult(event.result).map(({ data, mimeType }) => {
            const artifact = browserArtifacts.saveImage(data, mimeType, artifactKind);
            store.addRunArtifact(runId, event.toolCallId, artifact);
            return artifact;
          });
          store.finishToolActivity(runId, event.toolCallId, event.toolName, event.isError, output);
          emit(sender, { type: 'tool_end', runId, conversationId, toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError, output, artifacts });
          return;
        }
        if (event.type === 'completed') {
          runUsage = event.usage;
          return;
        }
        if (event.type !== 'text_delta') return;
        const delta = event.delta;
        if (!assistantCreated) {
          assistantCreatedAt = store.addMessage(conversationId, 'assistant', '', assistantMessageId).createdAt;
          assistantCreated = true;
        }
        assistantContent += delta;
        store.updateMessage(assistantMessageId, assistantContent);
        emit(sender, { type: 'delta', runId, conversationId, messageId: assistantMessageId, delta, createdAt: assistantCreatedAt! });
      },
    });
    if (run.controller.signal.aborted) {
      if (!assistantCreated) store.addMessage(conversationId, 'assistant', '', assistantMessageId);
      store.finishRun(runId, 'cancelled');
      emit(sender, { type: 'cancelled', runId, conversationId });
      return;
    }
    if (!assistantCreated) store.addMessage(conversationId, 'assistant', '', assistantMessageId);
    store.finishRun(runId, 'completed', undefined, runUsage);
    emit(sender, { type: 'completed', runId, conversationId, messageId: assistantMessageId });
  } catch (error) {
    const cancelled = run.controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
    if (!assistantCreated && cancelled) {
      store.finishRun(runId, 'cancelled');
      emit(sender, { type: 'cancelled', runId, conversationId });
    } else {
      const message = error instanceof Error ? error.message : 'Provider request failed.';
      store.finishRun(runId, cancelled ? 'cancelled' : 'failed', message);
      if (cancelled) emit(sender, { type: 'cancelled', runId, conversationId });
      else emit(sender, { type: 'failed', runId, conversationId, error: message });
    }
  } finally {
    try {
      await runtime?.dispose();
    } finally {
      releaseComputerUse?.();
      for (const attachment of runAttachments) attachments.delete(attachment.id);
      activeRuns.delete(runId);
    }
  }
}

function createWindow(): BrowserWindow {
  const bounds = visibleWindowBounds(loadWindowBounds());
  const window = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    title: '玉衡',
    backgroundColor: '#101214',
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 16 } }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  let saveTimer: NodeJS.Timeout | undefined;
  const scheduleBoundsSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      saveWindowBounds(window);
    }, 250);
  };
  window.on('resize', scheduleBoundsSave);
  window.on('move', scheduleBoundsSave);
  window.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = undefined;
    saveWindowBounds(window);
  });

  if (isDevelopment) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL as string);
    window.webContents.openDevTools({ mode: 'detach' });
  } else {
    void window.loadFile(path.join(__dirname, '../dist-renderer/index.html'));
  }
  return window;
}

function openTaskFromReminder(boardId: string, taskId: string): void {
  const existingWindow = BrowserWindow.getAllWindows()[0];
  const window = existingWindow ?? createWindow();
  if (!existingWindow || window.webContents.isLoadingMainFrame()) pendingTaskOpen = { boardId, taskId };
  else window.webContents.send('task:event', { type: 'open', boardId, taskId });
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

app.whenReady().then(() => {
  store = new AppStore(app.getPath('userData'));
  secrets = new SecretStore(app.getPath('userData'));
  taskAssets = new TaskAssetStore(path.join(app.getPath('userData'), 'task-assets'));
  browserUse = new BrowserUseSupervisor({ dataDir: path.join(app.getPath('userData'), 'browser-use') });
  browserArtifacts = new BrowserArtifactStore(path.join(app.getPath('userData'), 'browser-use', 'screenshots'));
  const artifactCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  for (const artifact of store.deleteRunArtifactsBefore(artifactCutoff.toISOString())) browserArtifacts.remove(artifact.url);
  browserArtifacts.deleteFilesBefore(artifactCutoff);
  taskReminders = new TaskReminderScheduler({
    listPending: () => store.listPendingTaskReminders(),
    claim: (taskId, expectedRemindAt) => store.markTaskReminderFired(taskId, expectedRemindAt),
    notify: (task, onClick) => {
      emitTaskChanged(task);
      const notification = new Notification({ title: '任务提醒', body: task.title });
      notification.on('click', onClick);
      notification.show();
    },
    openTask: openTaskFromReminder,
  });
  void protocol.handle(TASK_ASSET_SCHEME, (request) => {
    try {
      return net.fetch(pathToFileURL(taskAssets.resolveUrl(request.url)).toString());
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
  void protocol.handle(BROWSER_ARTIFACT_SCHEME, (request) => {
    try {
      return net.fetch(pathToFileURL(browserArtifacts.resolveUrl(request.url)).toString());
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
  store.recoverRunningRuns();
  taskReminders.refresh();

  ipcMain.handle('app:get-info', () => ({
    name: 'yuheng',
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  }));

  ipcMain.handle('search:query', (_event, rawQuery: unknown, rawLimit: unknown) => {
    const query = typeof rawQuery === 'string' ? rawQuery : '';
    const limit = typeof rawLimit === 'number' && Number.isFinite(rawLimit) ? rawLimit : undefined;
    return store.search(query, limit);
  });

  ipcMain.handle('conversations:list', (_event, includeArchived: unknown) => store.listConversations(includeArchived === true));
  ipcMain.handle('conversation-projects:list', () => store.listConversationProjects());
  ipcMain.handle('conversation-projects:create', (_event, name: unknown): ConversationProject => store.createConversationProject(assertText(name, 'name')));
  ipcMain.handle('conversation-projects:rename', (_event, projectId: unknown, name: unknown): ConversationProject => store.renameConversationProject(assertText(projectId, 'projectId'), assertText(name, 'name')));
  ipcMain.handle('conversation-projects:delete', (_event, projectId: unknown) => store.deleteConversationProject(assertText(projectId, 'projectId')));
  ipcMain.handle('conversations:messages', (_event, conversationId: unknown) => store.listMessages(assertText(conversationId, 'conversationId')));
  ipcMain.handle('conversations:create', (_event, title: unknown, projectId: unknown) => store.createConversation(typeof title === 'string' && title.trim() ? title.trim() : undefined, typeof projectId === 'string' && projectId.trim() ? projectId.trim() : undefined));
  ipcMain.handle('conversations:rename', (_event, conversationId: unknown, title: unknown) => store.renameConversation(assertText(conversationId, 'conversationId'), assertText(title, 'title')));
  ipcMain.handle('conversations:move', (_event, conversationId: unknown, projectId: unknown) => store.moveConversation(assertText(conversationId, 'conversationId'), assertText(projectId, 'projectId')));
  ipcMain.handle('conversations:archive', (_event, conversationId: unknown, archived: unknown) => store.setConversationArchived(assertText(conversationId, 'conversationId'), archived === true));
  ipcMain.handle('conversations:pin', (_event, conversationId: unknown, pinned: unknown) => store.setConversationPinned(assertText(conversationId, 'conversationId'), pinned === true));
  ipcMain.handle('conversations:delete', (_event, conversationId: unknown) => {
    const id = assertText(conversationId, 'conversationId');
    for (const run of activeRuns.values()) if (run.conversationId === id) throw new Error('该会话仍在处理中，请先停止运行。');
    store.deleteConversation(id);
    void fs.rm(path.join(app.getPath('userData'), 'pi-agent', 'sessions', id), { recursive: true, force: true });
  });
  ipcMain.handle('tasks:boards:list', (): TaskBoard[] => store.listTaskBoards());
  ipcMain.handle('tasks:boards:create', (_event, rawName: unknown): TaskBoard => {
    const board = store.createTaskBoard(taskBoardName(rawName));
    emitTaskBoardsChanged();
    return board;
  });
  ipcMain.handle('tasks:boards:rename', (_event, boardId: unknown, rawName: unknown): TaskBoard => {
    const board = store.renameTaskBoard(assertText(boardId, 'boardId'), taskBoardName(rawName));
    emitTaskBoardsChanged();
    return board;
  });
  ipcMain.handle('tasks:list', (_event, boardId: unknown) => store.listTasks(assertText(boardId, 'boardId')));
  ipcMain.handle('tasks:open-request:take', () => {
    const request = pendingTaskOpen;
    pendingTaskOpen = null;
    return request;
  });
  ipcMain.handle('tasks:types:list', (_event, boardId: unknown): TaskType[] => store.listTaskTypes(assertText(boardId, 'boardId')));
  ipcMain.handle('tasks:types:create', (_event, boardId: unknown, rawName: unknown): TaskType => {
    const taskType = store.createTaskType(taskTypeName(rawName), assertText(boardId, 'boardId'));
    emitTaskTypesChanged(taskType.boardId);
    return taskType;
  });
  ipcMain.handle('tasks:types:rename', (_event, taskTypeId: unknown, rawName: unknown): TaskType => {
    const taskType = store.renameTaskType(assertText(taskTypeId, 'taskTypeId'), taskTypeName(rawName));
    emitTaskTypesChanged(taskType.boardId);
    return taskType;
  });
  ipcMain.handle('tasks:create', (_event, boardId: unknown, raw: unknown) => {
    const task = store.createTask(taskInput(raw), assertText(boardId, 'boardId'));
    handleTaskChanged(task);
    return task;
  });
  ipcMain.handle('tasks:update', (_event, taskId: unknown, raw: unknown) => {
    const task = store.updateTask(assertText(taskId, 'taskId'), taskPatch(raw));
    handleTaskChanged(task);
    return task;
  });
  ipcMain.handle('tasks:assets:import', (_event, raw: unknown) => importTaskAsset(raw));
  ipcMain.handle('tasks:assets:pick', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = { properties: ['openFile', 'multiSelections'] };
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (result.canceled) return [];
    let totalBytes = 0;
    for (const filePath of result.filePaths) {
      const stats = await fs.stat(filePath);
      if (stats.size > MAX_TASK_ASSET_BYTES) throw new Error(`附件超过 10 MB：${path.basename(filePath)}`);
      totalBytes += stats.size;
      if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error('单次添加的附件总大小不能超过 20 MB。');
    }
    const imported: TaskAsset[] = [];
    for (const filePath of result.filePaths) {
      const data = await fs.readFile(filePath);
      imported.push(await taskAssets.import(path.basename(filePath), attachmentMimeType(filePath), data));
    }
    return imported;
  });
  ipcMain.handle('tasks:assets:open', async (_event, rawUrl: unknown) => {
    const error = await shell.openPath(taskAssets.resolveUrl(assertText(rawUrl, 'assetUrl')));
    if (error) throw new Error(error);
  });
  ipcMain.handle('runs:list', (_event, conversationId: unknown) => store.listRuns(assertText(conversationId, 'conversationId')));
  ipcMain.handle('provider:get', () => {
    const provider = store.getProvider();
    return provider ? { ...provider, hasApiKey: secrets.hasProviderKey() } : null;
  });
  ipcMain.handle('provider:save', (_event, raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new Error('Provider configuration is required.');
    const input = raw as Record<string, unknown>;
    const protocol = input.protocol === 'anthropic' ? 'anthropic' : input.protocol === 'openai' ? 'openai' : null;
    if (!protocol) throw new Error('Unsupported provider protocol.');
    const config = {
      protocol,
      baseUrl: assertText(input.baseUrl, 'baseUrl').replace(/\/$/, ''),
      model: assertText(input.model, 'model'),
      displayName: assertText(input.displayName, 'displayName'),
    } satisfies Omit<ProviderConfig, 'hasApiKey'>;
    const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
    if (apiKey) secrets.saveProviderKey(apiKey);
    else if (!secrets.hasProviderKey()) throw new Error('API key is required.');
    return { ...store.saveProvider(config), hasApiKey: secrets.hasProviderKey() };
  });
  ipcMain.handle('browser-use:get', (): BrowserUseConfig => store.getBrowserUseConfig());
  ipcMain.handle('browser-use:save', async (_event, raw: unknown): Promise<BrowserUseConfig> => {
    if (!raw || typeof raw !== 'object' || typeof (raw as Record<string, unknown>).enabled !== 'boolean') throw new Error('Browser Use enabled state is required.');
    const config = store.saveBrowserUseConfig({ enabled: (raw as Record<string, unknown>).enabled === true });
    if (!config.enabled) await browserUse.disable();
    return config;
  });
  ipcMain.handle('computer-use:get', (): ComputerUseConfig => store.getComputerUseConfig());
  ipcMain.handle('computer-use:save', async (_event, raw: unknown): Promise<ComputerUseConfig> => {
    if (!raw || typeof raw !== 'object' || typeof (raw as Record<string, unknown>).enabled !== 'boolean') throw new Error('Computer Use enabled state is required.');
    const config = store.saveComputerUseConfig({ enabled: (raw as Record<string, unknown>).enabled === true });
    if (config.enabled) await browserUse.disable();
    return config;
  });
  ipcMain.handle('reasoning:get', (_event, conversationId: unknown): ReasoningSelection => {
    if (typeof conversationId !== 'string' || !conversationId.trim()) throw new Error('Conversation ID is required.');
    return store.getReasoningSelection(conversationId);
  });
  ipcMain.handle('reasoning:save', (_event, conversationId: unknown, raw: unknown): ReasoningSelection => {
    if (typeof conversationId !== 'string' || !conversationId.trim()) throw new Error('Conversation ID is required.');
    if (raw !== 'default' && raw !== 'off' && raw !== 'low' && raw !== 'medium' && raw !== 'high' && raw !== 'xhigh' && raw !== 'max') throw new Error('Unsupported reasoning level.');
    return store.saveReasoningSelection(conversationId, raw);
  });
  ipcMain.handle('attachments:pick', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = { properties: ['openFile', 'multiSelections'], filters: [{ name: '支持的文件', extensions: Object.keys(allowedAttachmentTypes).map((extension) => extension.slice(1)) }] };
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (result.canceled) return [];
    const selected: StoredAttachment[] = [];
    let totalBytes = 0;
    for (const filePath of result.filePaths) {
      const extension = path.extname(filePath).toLowerCase();
      const mimeType = allowedAttachmentTypes[extension];
      if (!mimeType) throw new Error(`不支持的文件类型：${path.basename(filePath)}`);
      const data = await fs.readFile(filePath);
      if (data.byteLength > MAX_ATTACHMENT_BYTES) throw new Error(`文件超过 10 MB：${path.basename(filePath)}`);
      totalBytes += data.byteLength;
      if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error('附件总大小不能超过 20 MB。');
      selected.push({ id: crypto.randomUUID(), name: path.basename(filePath), mimeType, size: data.byteLength, data });
    }
    selected.forEach((attachment) => attachments.set(attachment.id, attachment));
    return selected.map(({ data: _data, ...attachment }) => attachment);
  });
  ipcMain.handle('attachments:release', (_event, attachmentIds: unknown) => {
    if (!Array.isArray(attachmentIds)) return;
    attachmentIds.forEach((id) => { if (typeof id === 'string') attachments.delete(id); });
  });
  ipcMain.handle('runs:start', (event, conversationId: unknown, content: unknown, attachmentIds: unknown, rawReasoningLevel: unknown) => {
    const id = assertText(conversationId, 'conversationId');
    const text = typeof content === 'string' ? content.trim() : '';
    const config = store.getProvider();
    const apiKey = secrets.getProviderKey();
    if (!config || !apiKey) throw new Error('请先配置 Provider 和 API Key。');
    const ids = Array.isArray(attachmentIds) ? attachmentIds.filter((id): id is string => typeof id === 'string') : [];
    const runAttachments = ids.map((id) => attachments.get(id)).filter((attachment): attachment is StoredAttachment => Boolean(attachment));
    if (runAttachments.length !== ids.length) throw new Error('附件已失效，请重新选择。');
    if (!text && runAttachments.length === 0) throw new Error('消息内容或附件不能为空。');
    for (const run of activeRuns.values()) {
      if (run.conversationId === id) throw new Error('该会话仍在处理中。');
    }
    const runId = crypto.randomUUID();
    const reasoningLevel = rawReasoningLevel == null ? undefined : (() => {
      if (rawReasoningLevel === 'off' || rawReasoningLevel === 'low' || rawReasoningLevel === 'medium' || rawReasoningLevel === 'high' || rawReasoningLevel === 'xhigh' || rawReasoningLevel === 'max') return rawReasoningLevel;
      throw new Error('不支持的推理级别。');
    })();
    const userMessage = store.addMessage(id, 'user', text);
    store.startRun(runId, id, userMessage.id);
    const controller = new AbortController();
    activeRuns.set(runId, { controller, conversationId: id, inputMessageId: userMessage.id });
    emit(event.sender, { type: 'accepted', runId, conversationId: id });
    setImmediate(() => { void executeRun(event.sender, runId, id, config, apiKey, runAttachments, reasoningLevel); });
    return { runId, userMessage, conversation: store.getConversation(id) };
  });
  ipcMain.handle('runs:retry', (event, conversationId: unknown, inputMessageId: unknown, content: unknown, rawReasoningLevel: unknown) => {
    const id = assertText(conversationId, 'conversationId');
    const messageId = assertText(inputMessageId, 'inputMessageId');
    const text = assertText(content, 'content');
    const config = store.getProvider();
    const apiKey = secrets.getProviderKey();
    if (!config || !apiKey) throw new Error('请先配置 Provider 和 API Key。');
    for (const run of activeRuns.values()) if (run.conversationId === id) throw new Error('该会话仍在处理中。');
    const reasoningLevel = rawReasoningLevel == null ? undefined : (() => {
      if (rawReasoningLevel === 'off' || rawReasoningLevel === 'low' || rawReasoningLevel === 'medium' || rawReasoningLevel === 'high' || rawReasoningLevel === 'xhigh' || rawReasoningLevel === 'max') return rawReasoningLevel;
      throw new Error('不支持的推理级别。');
    })();
    const existingMessages = store.listMessages(id);
    const inputIndex = existingMessages.findIndex((message) => message.id === messageId && message.role === 'user');
    if (inputIndex < 0) throw new Error('User message not found.');
    const replayUser = {
      ordinal: existingMessages.slice(0, inputIndex).filter((message) => message.role === 'user').length,
      content: existingMessages[inputIndex].content,
    };
    const userMessage = store.replaceFromUserMessage(id, messageId, text);
    const runId = crypto.randomUUID();
    store.startRun(runId, id, userMessage.id);
    const controller = new AbortController();
    activeRuns.set(runId, { controller, conversationId: id, inputMessageId: userMessage.id, replayUser });
    emit(event.sender, { type: 'accepted', runId, conversationId: id });
    setImmediate(() => { void executeRun(event.sender, runId, id, config, apiKey, [], reasoningLevel); });
    return { runId, userMessage, conversation: store.getConversation(id) };
  });
  ipcMain.handle('runs:cancel', (_event, runId: unknown) => {
    const run = activeRuns.get(assertText(runId, 'runId'));
    if (run) run.controller.abort();
  });
  ipcMain.handle('runs:approve', (event, approvalId: unknown, approved: unknown) => {
    const id = assertText(approvalId, 'approvalId');
    const pending = pendingApprovals.get(id);
    if (!pending || pending.senderId !== event.sender.id) return;
    pending.finish(approved === true);
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  for (const run of activeRuns.values()) run.controller.abort();
  for (const approval of pendingApprovals.values()) approval.finish(false);
  taskReminders?.dispose();
  void browserUse?.dispose();
  store?.close();
});
