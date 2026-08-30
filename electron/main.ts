import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, Notification, protocol, screen, shell, Tray, type OpenDialogOptions, type Rectangle, type WebContents } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { AppStore, DEFAULT_PROVIDER_CONTEXT_WINDOW, MAX_PROVIDER_CONTEXT_WINDOW, MIN_PROVIDER_CONTEXT_WINDOW, type BackupConfig, type BrowserUseConfig, type ComputerUseConfig, type ConversationProject, type CreateTaskInput, type DesktopPetConfig, type DesktopPresenceConfig, type ProviderConfig, type ReasoningSelection, type RunUsage, type Task, type TaskBoard, type TaskPriority, type TaskStatus, type TaskType, type UpdateTaskInput } from './store';
import { SecretStore } from './secrets';
import { createPiRuntime, createPiSessionFactory, type ReasoningLevel } from './pi-runtime';
import { loadYuhengSystemPrompt } from './system-prompt';
import { MAX_TASK_ASSET_BYTES, TASK_ASSET_SCHEME, TaskAssetStore, type TaskAsset } from './task-assets';
import { MAX_NOTE_COVER_BYTES, NOTE_COVER_SCHEME, NoteCoverStore } from './note-covers';
import { BrowserUseSupervisor, redactBrowserToolInput, type BrowserToolName } from './browser-use';
import { TaskReminderScheduler } from './task-reminders';
import { BROWSER_ARTIFACT_SCHEME, BrowserArtifactStore, browserImagesFromToolResult, type BrowserArtifact } from './browser-artifacts';
import { ComputerUseLease, redactComputerUseToolInput, type ComputerUseToolName } from './computer-use';
import { applicationVersion } from './app-info';
import { getAgentProfile, isAgentProfileId, loadAgentProfilePrompt, formatRuntimeContext } from './agent-profiles';
import { MAX_CONVERSATION_BACKUP_BYTES, conversationBackupMarkdown, parseConversationBackup } from './conversation-backup';
import { testProviderConnection, type ProviderTestResult } from './provider-test';
import { externalHttpUrl } from './external-links';
import { createFullBackup, restoreFullBackup } from './full-backup';
import { BackupRunAdmission } from './backup-run-admission';
import { trayReminderTitle } from './tray-state';
import { readCodexPetAsset, scanCodexPets, type CodexPetManifest } from './pets';

protocol.registerSchemesAsPrivileged([
  { scheme: TASK_ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: BROWSER_ARTIFACT_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: NOTE_COVER_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const isDevelopment = Boolean(process.env.ELECTRON_RENDERER_URL);
const applicationVersionValue = applicationVersion(path.resolve(__dirname, '..'));
let store: AppStore;
let secrets: SecretStore;
let taskAssets: TaskAssetStore;
let noteCovers: NoteCoverStore;
let browserUse: BrowserUseSupervisor;
let browserArtifacts: BrowserArtifactStore;
let petWindow: BrowserWindow | null = null;
let currentPetState: 'idle' | 'working' | 'celebrate' = 'idle';
let petDragState: { senderId: number; pointerX: number; pointerY: number; windowX: number; windowY: number } | null = null;
const computerUseLease = new ComputerUseLease();
let taskReminders: TaskReminderScheduler;
let pendingTaskOpen: { boardId: string; taskId: string } | null = null;
const activeRuns = new Map<string, { controller: AbortController; conversationId: string; inputMessageId: string; replayUser?: { ordinal: number; content: string } }>();
const backupRunAdmission = new BackupRunAdmission();
const pendingApprovals = new Map<string, { runId: string; senderId: number; finish: (approved: boolean) => void }>();
let shutdownRequested = false;
let shutdownReady = false;
let resourcesClosed = false;
let automaticBackupTimer: NodeJS.Timeout | undefined;
let tray: Tray | undefined;
let unreadReminderCount = 0;
let allowWindowClose = false;
let desktopPresenceConfig: DesktopPresenceConfig = { notificationsEnabled: true, menuBarEnabled: true };
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
const PET_STATE_FILE = 'desktop-pet-state.json';
const PET_WINDOW_SIZE = 188;

function windowStatePath(): string {
  return path.join(app.getPath('userData'), WINDOW_STATE_FILE);
}

function petStatePath(): string {
  return path.join(app.getPath('userData'), PET_STATE_FILE);
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

function loadPetPosition(): { x: number; y: number } | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(petStatePath(), 'utf8'));
    if (!parsed || typeof parsed !== 'object') return undefined;
    const state = parsed as Record<string, unknown>;
    const x = finiteNumber(state.x);
    const y = finiteNumber(state.y);
    return x !== undefined && y !== undefined ? { x: Math.round(x), y: Math.round(y) } : undefined;
  } catch {
    return undefined;
  }
}

function visiblePetPosition(saved: { x: number; y: number } | undefined): { x: number; y: number } {
  const displays = screen.getAllDisplays();
  const display = saved
    ? displays.find((candidate) => saved.x >= candidate.bounds.x && saved.x < candidate.bounds.x + candidate.bounds.width && saved.y >= candidate.bounds.y && saved.y < candidate.bounds.y + candidate.bounds.height) ?? screen.getPrimaryDisplay()
    : screen.getPrimaryDisplay();
  const workArea = display.workArea;
  return {
    x: Math.min(Math.max(saved?.x ?? workArea.x + workArea.width - PET_WINDOW_SIZE - 28, workArea.x), workArea.x + workArea.width - PET_WINDOW_SIZE),
    y: Math.min(Math.max(saved?.y ?? workArea.y + workArea.height - PET_WINDOW_SIZE - 28, workArea.y), workArea.y + workArea.height - PET_WINDOW_SIZE),
  };
}

function savePetPosition(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  const [x, y] = window.getPosition();
  const filePath = petStatePath();
  const temporaryPath = `${filePath}.tmp`;
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(temporaryPath, JSON.stringify({ x, y }), 'utf8');
    renameSync(temporaryPath, filePath);
  } catch {
    // Pet position is best effort and must not prevent the app from closing.
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

function assertNoteCover(value: unknown): string {
  const cover = assertText(value, 'cover');
  if (/^[a-z][a-z0-9-]{0,40}$/.test(cover) || /^yuheng-note-cover:\/\/local\/[0-9a-f-]{36}\.(?:png|jpg|webp)$/i.test(cover)) return cover;
  throw new Error('Invalid note cover.');
}

function emit(sender: WebContents, event: RunEvent): void {
  if (!sender.isDestroyed()) sender.send('run:event', event);
  const petState = event.type === 'accepted' || event.type === 'tool_start' || event.type === 'approval_required'
    ? 'working'
    : event.type === 'completed'
      ? 'celebrate'
      : event.type === 'failed' || event.type === 'cancelled'
        ? 'idle'
        : null;
  if (petState) {
    currentPetState = petState;
    if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('pet:state', petState);
  }
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
  const profileId = store.getConversationProfile(conversationId);
  const profile = getAgentProfile(profileId);
  let releaseComputerUse: (() => void) | undefined;
  let runtime: ReturnType<typeof createPiRuntime> | undefined;
  try {
    if (computerUseConfig.enabled) releaseComputerUse = await computerUseLease.acquire(run.controller.signal);
    runtime = createPiRuntime({ sessionFactory: createPiSessionFactory(config, apiKey, {
    agentDir: path.join(app.getPath('userData'), 'pi-agent'),
    yuhengSystemPrompt: loadYuhengSystemPrompt(app.getAppPath()),
    profilePrompt: loadAgentProfilePrompt(app.getAppPath(), profileId),
    runtimeContext: profile.timeContext === 'full' ? formatRuntimeContext() : undefined,
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
      const rawMessage = error instanceof Error ? error.message : 'Provider request failed.';
      const message = (apiKey ? rawMessage.replaceAll(apiKey, '[redacted]') : rawMessage).slice(0, 2_000);
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

function closeResources(): void {
  if (resourcesClosed) return;
  // A timed-out run may still be unwinding in executeRun. Keep SQLite open so
  // its final cancellation write cannot race a closed connection; process exit
  // will reclaim the handle if the worker never responds.
  if (activeRuns.size > 0) return;
  resourcesClosed = true;
  if (automaticBackupTimer) { clearInterval(automaticBackupTimer); automaticBackupTimer = undefined; }
  taskReminders?.dispose();
  void browserUse?.dispose();
  store?.close();
}

function waitForActiveRuns(timeoutMs: number): Promise<void> {
  if (activeRuns.size === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (activeRuns.size === 0 || Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        resolve();
      }
    }, 25);
  });
}

function defaultBackupDirectory(): string { return path.join(app.getPath('userData'), 'backups'); }

async function runAutomaticBackup(): Promise<void> {
  if (!store || activeRuns.size > 0) return;
  try {
    await backupRunAdmission.run(async () => {
      if (activeRuns.size > 0) return;
      const config = store.getBackupConfig(defaultBackupDirectory());
      if (!config.enabled) return;
      const today = new Date().toISOString().slice(0, 10);
      await fs.mkdir(config.directory, { recursive: true });
      const existing = (await fs.readdir(config.directory).catch(() => [])).filter((name) => name.endsWith('.yuheng') && name.includes(today));
      if (existing.length > 0) return;
      try {
        const archive = await createFullBackup({ dataDir: app.getPath('userData'), store, providerKeys: secrets.exportProviderKeys(), appVersion: applicationVersionValue, platform: `${process.platform}-${process.arch}` });
        const target = path.join(config.directory, `yuheng-auto-${today}.yuheng`);
        await fs.writeFile(`${target}.tmp`, archive, { flag: 'wx', mode: 0o600 });
        await fs.rename(`${target}.tmp`, target);
        const files = (await fs.readdir(config.directory)).filter((name) => name.startsWith('yuheng-auto-') && name.endsWith('.yuheng')).sort().reverse();
        for (const stale of files.slice(config.retention)) await fs.rm(path.join(config.directory, stale), { force: true });
        store.saveBackupConfig({ ...config, lastRunAt: new Date().toISOString(), lastError: null });
      } catch (error) {
        store.saveBackupConfig({ ...config, lastError: error instanceof Error ? error.message.slice(0, 500) : '自动备份失败。' });
      }
    });
  } catch {
    // A manual export already owns the admission gate.
  }
}

function createTray(window: BrowserWindow): void {
  if (process.platform !== 'darwin' || tray || !desktopPresenceConfig.menuBarEnabled) return;
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><path fill="none" stroke="black" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M9 2.2 15.5 6v6L9 15.8 2.5 12V6L9 2.2Z"/><path fill="none" stroke="black" stroke-width="1.4" stroke-linecap="round" d="m5.4 8.9 2.2 2.2 4.8-4.8"/></svg>')}`);
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('玉衡');
  const refreshMenu = () => {
    tray?.setTitle(trayReminderTitle(unreadReminderCount));
    tray?.setContextMenu(Menu.buildFromTemplate([
      { label: unreadReminderCount > 0 ? `待处理提醒（${trayReminderTitle(unreadReminderCount)}）` : '暂无待处理提醒', enabled: false },
      { type: 'separator' },
      { label: '打开玉衡', click: () => { unreadReminderCount = 0; refreshMenu(); window.show(); window.focus(); } },
      { label: '退出玉衡', click: () => { allowWindowClose = true; app.quit(); } },
    ]));
  };
  tray.on('click', () => { unreadReminderCount = 0; refreshMenu(); window.show(); window.focus(); });
  refreshMenu();
}

function destroyTray(): void {
  if (!tray) return;
  tray.destroy();
  tray = undefined;
  unreadReminderCount = 0;
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
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    const externalUrl = externalHttpUrl(url);
    if (externalUrl) void shell.openExternal(externalUrl);
    return { action: 'deny' };
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
  window.on('enter-full-screen', () => window.webContents.send('window:fullscreen', true));
  window.on('leave-full-screen', () => window.webContents.send('window:fullscreen', false));
  window.on('close', (event) => {
    if (!allowWindowClose && process.platform === 'darwin' && desktopPresenceConfig.menuBarEnabled) {
      event.preventDefault();
      window.hide();
      return;
    }
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

function mainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((candidate) => candidate !== petWindow && !candidate.isDestroyed());
}

function focusMainWindow(): void {
  const window = mainWindow() ?? createWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function createPetWindow(): BrowserWindow {
  if (petWindow && !petWindow.isDestroyed()) return petWindow;
  const position = visiblePetPosition(loadPetPosition());
  const window = new BrowserWindow({
    ...position,
    width: PET_WINDOW_SIZE,
    height: PET_WINDOW_SIZE,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  petWindow = window;
  window.setAlwaysOnTop(true, 'floating');
  let saveTimer: NodeJS.Timeout | undefined;
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = undefined; savePetPosition(window); }, 250);
  };
  window.on('move', scheduleSave);
  window.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = undefined;
    savePetPosition(window);
  });
  window.on('closed', () => { petWindow = null; petDragState = null; });
  if (isDevelopment) {
    const rendererUrl = new URL(process.env.ELECTRON_RENDERER_URL as string);
    rendererUrl.searchParams.set('pet', '1');
    void window.loadURL(rendererUrl.toString());
  } else {
    void window.loadFile(path.join(__dirname, '../dist-renderer/index.html'), { query: { pet: '1' } });
  }
  window.webContents.on('did-finish-load', () => {
    if (!window.isDestroyed()) window.webContents.send('pet:state', currentPetState);
  });
  window.once('ready-to-show', () => { if (!window.isDestroyed()) window.showInactive(); });
  return window;
}

function openTaskFromReminder(boardId: string, taskId: string): void {
  const existingWindow = mainWindow();
  const window = existingWindow ?? createWindow();
  if (!existingWindow || window.webContents.isLoadingMainFrame()) pendingTaskOpen = { boardId, taskId };
  else window.webContents.send('task:event', { type: 'open', boardId, taskId });
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

app.whenReady().then(() => {
  store = new AppStore(app.getPath('userData'));
  desktopPresenceConfig = store.getDesktopPresenceConfig();
  secrets = new SecretStore(app.getPath('userData'));
  taskAssets = new TaskAssetStore(path.join(app.getPath('userData'), 'task-assets'));
  noteCovers = new NoteCoverStore(path.join(app.getPath('userData'), 'note-covers'));
  browserUse = new BrowserUseSupervisor({ dataDir: path.join(app.getPath('userData'), 'browser-use') });
  browserArtifacts = new BrowserArtifactStore(path.join(app.getPath('userData'), 'browser-use', 'screenshots'));
  const artifactCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  for (const artifact of store.deleteRunArtifactsBefore(artifactCutoff.toISOString())) browserArtifacts.remove(artifact.url);
  browserArtifacts.deleteFilesBefore(artifactCutoff);
  taskReminders = new TaskReminderScheduler({
    listPending: () => store.listPendingTaskReminders(),
    claim: (taskId, expectedRemindAt) => store.markTaskReminderFired(taskId, expectedRemindAt),
    notify: (task, onClick) => {
      unreadReminderCount += 1;
      tray?.setTitle(trayReminderTitle(unreadReminderCount));
      emitTaskChanged(task);
      if (!desktopPresenceConfig.notificationsEnabled) return;
      const notification = new Notification({ title: '玉衡 · 任务提醒', body: task.title, silent: false });
      notification.on('click', () => { unreadReminderCount = 0; tray?.setTitle(''); onClick(); });
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
  void protocol.handle(NOTE_COVER_SCHEME, (request) => {
    try { return net.fetch(pathToFileURL(noteCovers.resolveUrl(request.url)).toString()); }
    catch { return new Response('Not found', { status: 404 }); }
  });
  store.recoverRunningRuns();
  taskReminders.refresh();
  automaticBackupTimer = setInterval(() => { void runAutomaticBackup(); }, 60 * 60 * 1000);

  ipcMain.handle('app:get-info', () => ({
    name: 'yuheng',
    version: applicationVersionValue,
    platform: process.platform,
    arch: process.arch,
  }));
  ipcMain.handle('app:open-external', async (_event, rawUrl: unknown) => {
    const url = externalHttpUrl(rawUrl);
    if (!url) throw new Error('只允许打开 http 或 https 链接。');
    await shell.openExternal(url);
  });

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
  ipcMain.handle('conversations:branch', (_event, conversationId: unknown, messageId: unknown) => store.branchConversation(assertText(conversationId, 'conversationId'), assertText(messageId, 'messageId')));
  ipcMain.handle('notes:list', (_event, includeArchived: unknown) => store.listNotes(includeArchived === true));
  ipcMain.handle('notes:get', (_event, id: unknown) => store.getNote(assertText(id, 'noteId')));
  ipcMain.handle('notes:create', (_event, title: unknown, parentId: unknown) => {
    const normalizedParentId = parentId == null || parentId === '' ? null : assertText(parentId, 'parentId');
    return store.createNote(typeof title === 'string' ? title : undefined, normalizedParentId);
  });
  ipcMain.handle('notes:update', (_event, id: unknown, rawPatch: unknown) => {
    const noteId = assertText(id, 'noteId');
    if (!rawPatch || typeof rawPatch !== 'object') throw new Error('Note patch is required.');
    const input = rawPatch as Record<string, unknown>;
    const patch = {
      ...(input.title === undefined ? {} : { title: assertText(input.title, 'title') }),
      ...(input.content === undefined ? {} : { content: typeof input.content === 'string' ? input.content : (() => { throw new Error('content must be text.'); })() }),
      ...(input.archived === undefined ? {} : { archived: input.archived === true }),
      ...(input.icon === undefined ? {} : { icon: input.icon == null ? null : assertText(input.icon, 'icon') }),
      ...(input.cover === undefined ? {} : { cover: input.cover == null ? null : assertNoteCover(input.cover) }),
    };
    const previous = store.getNote(noteId);
    const updated = store.updateNote(noteId, patch);
    if (previous?.cover && previous.cover !== updated.cover && previous.cover.startsWith(`${NOTE_COVER_SCHEME}://`)) noteCovers.remove(previous.cover);
    return updated;
  });
  ipcMain.handle('notes:move', (_event, id: unknown, parentId: unknown, targetId: unknown) => store.moveNote(assertText(id, 'noteId'), parentId == null || parentId === '' ? null : assertText(parentId, 'parentId'), targetId == null || targetId === '' ? undefined : assertText(targetId, 'targetId')));
  ipcMain.handle('notes:delete', (_event, id: unknown) => {
    const noteId = assertText(id, 'noteId');
    const notes = store.listNotes(true);
    const ids = new Set<string>([noteId]);
    let changed = true;
    while (changed) { changed = false; for (const note of notes) if (note.parentId && ids.has(note.parentId) && !ids.has(note.id)) { ids.add(note.id); changed = true; } }
    for (const note of notes) if (ids.has(note.id) && note.cover?.startsWith(`${NOTE_COVER_SCHEME}://`)) noteCovers.remove(note.cover);
    store.deleteNote(noteId);
  });
  ipcMain.handle('notes:covers:pick', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const result = owner ? await dialog.showOpenDialog(owner, { properties: ['openFile'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] }) : await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    const stats = await fs.stat(filePath);
    if (stats.size > MAX_NOTE_COVER_BYTES) throw new Error('封面图片不能超过 15 MB。');
    return noteCovers.import(path.basename(filePath), attachmentMimeType(filePath), await fs.readFile(filePath));
  });
  ipcMain.handle('conversations:create', (_event, title: unknown, projectId: unknown, providerId: unknown, profileId: unknown) => {
    const selectedProfile = profileId == null ? undefined : (isAgentProfileId(profileId) ? profileId : (() => { throw new Error('Profile not found.'); })());
    return store.createConversation(typeof title === 'string' && title.trim() ? title.trim() : undefined, typeof projectId === 'string' && projectId.trim() ? projectId.trim() : undefined, typeof providerId === 'string' && providerId.trim() ? providerId.trim() : undefined, selectedProfile);
  });
  ipcMain.handle('conversations:set-provider', (_event, conversationId: unknown, providerId: unknown) => {
    const id = assertText(conversationId, 'conversationId');
    store.setConversationProvider(id, assertText(providerId, 'providerId'));
    return store.getConversation(id);
  });
  ipcMain.handle('conversations:set-profile', (_event, conversationId: unknown, profileId: unknown) => {
    const id = assertText(conversationId, 'conversationId');
    if (!isAgentProfileId(profileId)) throw new Error('Profile not found.');
    store.setConversationProfile(id, profileId);
    return store.getConversation(id);
  });
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
  ipcMain.handle('conversations:export', async (event, conversationId: unknown) => {
    const id = assertText(conversationId, 'conversationId');
    const backup = store.exportConversation(id);
    const owner = BrowserWindow.fromWebContents(event.sender);
    const result = owner
      ? await dialog.showSaveDialog(owner, { defaultPath: `${backup.conversation.title || '会话'}.json`, filters: [{ name: '玉衡会话备份', extensions: ['json'] }, { name: 'Markdown', extensions: ['md'] }] })
      : await dialog.showSaveDialog({ defaultPath: `${backup.conversation.title || '会话'}.json`, filters: [{ name: '玉衡会话备份', extensions: ['json'] }, { name: 'Markdown', extensions: ['md'] }] });
    if (result.canceled || !result.filePath) return null;
    const content = result.filePath.toLowerCase().endsWith('.md') ? conversationBackupMarkdown(backup) : JSON.stringify(backup, null, 2);
    await fs.writeFile(result.filePath, content, 'utf8');
    return result.filePath;
  });
  ipcMain.handle('conversations:import', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const result = owner
      ? await dialog.showOpenDialog(owner, { properties: ['openFile'], filters: [{ name: '玉衡会话备份', extensions: ['json'] }] })
      : await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: '玉衡会话备份', extensions: ['json'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_CONVERSATION_BACKUP_BYTES) throw new Error('会话备份超过 5 MB。');
    const parsed = parseConversationBackup(JSON.parse(await fs.readFile(filePath, 'utf8')));
    return store.importConversation(parsed);
  });
  ipcMain.handle('backup:export', async () => {
    return backupRunAdmission.run(async () => {
      await waitForActiveRuns(10 * 60 * 1000);
      if (activeRuns.size > 0) throw new Error('当前仍有运行中的任务，请稍后再试。');
      const target = await dialog.showSaveDialog({ defaultPath: path.join(app.getPath('documents'), `yuheng-backup-${new Date().toISOString().slice(0, 10)}.yuheng`), filters: [{ name: '玉衡备份', extensions: ['yuheng'] }] });
      if (target.canceled || !target.filePath) return null;
      const archive = await createFullBackup({ dataDir: app.getPath('userData'), store, providerKeys: secrets.exportProviderKeys(), appVersion: applicationVersionValue, platform: `${process.platform}-${process.arch}` });
      const temp = `${target.filePath}.tmp-${crypto.randomUUID()}`;
      try { await fs.writeFile(temp, archive, { flag: 'wx' }); await fs.rename(temp, target.filePath); return target.filePath; }
      catch (error) { await fs.rm(temp, { force: true }); throw error; }
    });
  });
  ipcMain.handle('backup:import', async () => {
    const selected = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: '玉衡备份', extensions: ['yuheng'] }] });
    if (selected.canceled || !selected.filePaths[0]) return null;
    const archive = await fs.readFile(selected.filePaths[0]);
    const report = await restoreFullBackup({ dataDir: app.getPath('userData'), store, archive });
    secrets.saveProviderKeys(report.providerKeys);
    const { conversationMap: _conversationMap, providerKeys: _providerKeys, ...publicReport } = report;
    return publicReport;
  });
  ipcMain.handle('backup:get-config', (): BackupConfig => store.getBackupConfig(defaultBackupDirectory()));
  ipcMain.handle('backup:save-config', (_event, raw: unknown): BackupConfig => {
    if (!raw || typeof raw !== 'object') throw new Error('无效的备份设置。');
    const input = raw as Record<string, unknown>;
    const directory = typeof input.directory === 'string' && input.directory.trim() ? input.directory.trim() : defaultBackupDirectory();
    const retention = typeof input.retention === 'number' && Number.isFinite(input.retention) ? input.retention : 7;
    const saved = store.saveBackupConfig({ enabled: input.enabled === true, directory, retention });
    if (saved.enabled) void runAutomaticBackup();
    return saved;
  });
  ipcMain.handle('desktop-presence:get-config', (): DesktopPresenceConfig => desktopPresenceConfig);
  ipcMain.handle('desktop-presence:save-config', (_event, raw: unknown): DesktopPresenceConfig => {
    if (!raw || typeof raw !== 'object') throw new Error('无效的通知设置。');
    const input = raw as Record<string, unknown>;
    desktopPresenceConfig = store.saveDesktopPresenceConfig({ notificationsEnabled: input.notificationsEnabled !== false, menuBarEnabled: input.menuBarEnabled !== false });
    const primaryWindow = mainWindow();
    if (desktopPresenceConfig.menuBarEnabled && primaryWindow) createTray(primaryWindow);
    else if (!desktopPresenceConfig.menuBarEnabled) destroyTray();
    return desktopPresenceConfig;
  });
  ipcMain.handle('pet:get', (): DesktopPetConfig => store.getDesktopPetConfig());
  ipcMain.handle('pet:list', async (): Promise<CodexPetManifest[]> => scanCodexPets([
    { path: path.join(process.env.CODEX_HOME || path.join(homedir(), '.codex'), 'pets'), source: 'codex' },
    { path: path.join(app.getPath('userData'), 'pets'), source: 'yuheng' },
  ]));
  ipcMain.handle('pet:asset', async (_event, rawPetId: unknown) => {
    if (typeof rawPetId !== 'string' || !rawPetId.trim()) return null;
    const manifests = await scanCodexPets([
      { path: path.join(process.env.CODEX_HOME || path.join(homedir(), '.codex'), 'pets'), source: 'codex' },
      { path: path.join(app.getPath('userData'), 'pets'), source: 'yuheng' },
    ]);
    const manifest = manifests.find((item) => item.id === rawPetId.trim());
    if (!manifest) return null;
    const buffer = await readCodexPetAsset(manifest);
    const size = nativeImage.createFromBuffer(buffer).getSize();
    if ((size.width > 0 || size.height > 0) && (size.width !== manifest.columns * manifest.cellWidth || size.height !== manifest.rows * manifest.cellHeight)) {
      throw new Error('宠物精灵表尺寸与 Codex Pet 规范不匹配。');
    }
    return { manifest, dataUrl: `data:image/webp;base64,${buffer.toString('base64')}` };
  });
  ipcMain.handle('pet:open-folder', async () => {
    const folder = path.join(process.env.CODEX_HOME || path.join(homedir(), '.codex'), 'pets');
    await fs.mkdir(folder, { recursive: true });
    const error = await shell.openPath(folder);
    if (error) throw new Error(error);
  });
  ipcMain.handle('pet:save', (_event, raw: unknown): DesktopPetConfig => {
    if (!raw || typeof raw !== 'object' || typeof (raw as Record<string, unknown>).enabled !== 'boolean') {
      throw new Error('无效的桌面宠物设置。');
    }
    const input = raw as Record<string, unknown>;
    const scale = typeof input.scale === 'number' && Number.isFinite(input.scale) ? Math.min(1.4, Math.max(0.8, input.scale)) : undefined;
    const config = store.saveDesktopPetConfig({ enabled: input.enabled === true, ...(typeof input.petId === 'string' ? { petId: input.petId } : {}), ...(scale ? { scale } : {}) });
    if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('pet:config', config);
    if (config.enabled) createPetWindow();
    else if (petWindow && !petWindow.isDestroyed()) petWindow.close();
    return config;
  });
  ipcMain.handle('pet:focus-main', () => focusMainWindow());
  ipcMain.on('pet:drag-start', (event, rawScreenX: unknown, rawScreenY: unknown) => {
    if (!petWindow || petWindow.isDestroyed() || event.sender !== petWindow.webContents) return;
    const pointerX = finiteNumber(rawScreenX);
    const pointerY = finiteNumber(rawScreenY);
    if (pointerX === undefined || pointerY === undefined) return;
    const [windowX, windowY] = petWindow.getPosition();
    petDragState = { senderId: event.sender.id, pointerX, pointerY, windowX, windowY };
  });
  ipcMain.on('pet:drag-move', (event, rawScreenX: unknown, rawScreenY: unknown) => {
    const drag = petDragState;
    if (!drag || drag.senderId !== event.sender.id || !petWindow || petWindow.isDestroyed() || event.sender !== petWindow.webContents) return;
    const pointerX = finiteNumber(rawScreenX);
    const pointerY = finiteNumber(rawScreenY);
    if (pointerX === undefined || pointerY === undefined) return;
    const position = visiblePetPosition({
      x: Math.round(drag.windowX + pointerX - drag.pointerX),
      y: Math.round(drag.windowY + pointerY - drag.pointerY),
    });
    petWindow.setPosition(position.x, position.y);
  });
  ipcMain.on('pet:drag-end', (event) => {
    if (petDragState?.senderId === event.sender.id) petDragState = null;
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
  ipcMain.handle('tasks:boards:reorder', (_event, boardId: unknown, targetBoardId: unknown): TaskBoard[] => {
    const boards = store.reorderTaskBoards(assertText(boardId, 'boardId'), assertText(targetBoardId, 'targetBoardId'));
    emitTaskBoardsChanged();
    return boards;
  });
  ipcMain.handle('tasks:boards:delete', (_event, boardId: unknown) => {
    store.deleteTaskBoard(assertText(boardId, 'boardId'));
    emitTaskBoardsChanged();
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
  ipcMain.handle('tasks:types:delete', (_event, taskTypeId: unknown) => {
    const id = assertText(taskTypeId, 'taskTypeId');
    const taskType = store.deleteTaskType(id);
    emitTaskTypesChanged(taskType.boardId);
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
  ipcMain.handle('tasks:reorder', (_event, taskId: unknown, targetTaskId: unknown) => {
    const tasks = store.reorderTask(assertText(taskId, 'taskId'), assertText(targetTaskId, 'targetTaskId'));
    emitTaskBoardsChanged();
    return tasks;
  });
  ipcMain.handle('tasks:move-board', (_event, taskId: unknown, boardId: unknown) => {
    const task = store.moveTaskToBoard(assertText(taskId, 'taskId'), assertText(boardId, 'boardId'));
    handleTaskChanged(task);
    return task;
  });
  ipcMain.handle('tasks:copy-board', (_event, taskId: unknown, boardId: unknown) => {
    const task = store.copyTaskToBoard(assertText(taskId, 'taskId'), assertText(boardId, 'boardId'));
    handleTaskChanged(task);
    return task;
  });
  ipcMain.handle('tasks:delete', (_event, taskId: unknown) => {
    store.deleteTask(assertText(taskId, 'taskId'));
    emitTaskBoardsChanged();
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
    return provider ? { ...provider, hasApiKey: secrets.hasProviderKey(provider.id ?? 'default') } : null;
  });
  ipcMain.handle('provider:list', () => store.listProviders().map((provider) => ({ ...provider, hasApiKey: secrets.hasProviderKey(provider.id ?? 'default') })));
  ipcMain.handle('provider:delete', (_event, providerId: unknown) => {
    const id = assertText(providerId, 'providerId');
    store.deleteProvider(id);
    secrets.deleteProviderKey(id);
  });
  ipcMain.handle('provider:save', (_event, raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new Error('Provider configuration is required.');
    const input = raw as Record<string, unknown>;
    const protocol = input.protocol === 'anthropic' ? 'anthropic' : input.protocol === 'openai' ? 'openai' : null;
    if (!protocol) throw new Error('Unsupported provider protocol.');
    const contextWindow = input.contextWindow == null ? DEFAULT_PROVIDER_CONTEXT_WINDOW : Number(input.contextWindow);
    if (!Number.isInteger(contextWindow) || contextWindow < MIN_PROVIDER_CONTEXT_WINDOW || contextWindow > MAX_PROVIDER_CONTEXT_WINDOW) throw new Error(`上下文窗口必须是 ${MIN_PROVIDER_CONTEXT_WINDOW.toLocaleString()} 到 ${MAX_PROVIDER_CONTEXT_WINDOW.toLocaleString()} 之间的整数。`);
    const providerId = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : undefined;
    const config = {
      ...(providerId ? { id: providerId } : {}),
      protocol,
      baseUrl: assertText(input.baseUrl, 'baseUrl').replace(/\/$/, ''),
      model: assertText(input.model, 'model'),
      displayName: assertText(input.displayName, 'displayName'),
      contextWindow,
    } satisfies Omit<ProviderConfig, 'hasApiKey' | 'id'> & { id?: string };
    const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
    if (!apiKey && (!providerId || !secrets.hasProviderKey(providerId))) throw new Error('API key is required.');
    const saved = store.saveProvider(config);
    const savedId = assertText(saved.id, 'providerId');
    if (apiKey) secrets.saveProviderKey(savedId, apiKey);
    return { ...saved, id: savedId, hasApiKey: secrets.hasProviderKey(savedId) };
  });
  ipcMain.handle('provider:test', async (_event, raw: unknown): Promise<ProviderTestResult> => {
    if (!raw || typeof raw !== 'object') throw new Error('Provider configuration is required.');
    const input = raw as Record<string, unknown>;
    const protocol = input.protocol === 'anthropic' ? 'anthropic' : input.protocol === 'openai' ? 'openai' : null;
    if (!protocol) throw new Error('Unsupported provider protocol.');
    const providerId = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : undefined;
    const apiKey = typeof input.apiKey === 'string' && input.apiKey.trim() ? input.apiKey.trim() : providerId ? secrets.getProviderKey(providerId) : null;
    if (!apiKey) throw new Error('API key is required.');
    const config: ProviderConfig = { id: providerId ?? 'test', protocol, baseUrl: assertText(input.baseUrl, 'baseUrl').replace(/\/$/, ''), model: assertText(input.model, 'model'), displayName: typeof input.displayName === 'string' ? input.displayName : '测试 Provider', contextWindow: Number(input.contextWindow) || DEFAULT_PROVIDER_CONTEXT_WINDOW, hasApiKey: true };
    return testProviderConnection(config, apiKey);
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
    backupRunAdmission.assertRunAllowed();
    const text = typeof content === 'string' ? content.trim() : '';
    const providerId = store.getConversationProviderId(id);
    const config = providerId ? store.getProvider(providerId) : null;
    const apiKey = providerId ? secrets.getProviderKey(providerId) : null;
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
    backupRunAdmission.assertRunAllowed();
    const messageId = assertText(inputMessageId, 'inputMessageId');
    const text = assertText(content, 'content');
    const providerId = store.getConversationProviderId(id);
    const config = providerId ? store.getProvider(providerId) : null;
    const apiKey = providerId ? secrets.getProviderKey(providerId) : null;
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

  const primaryWindow = createWindow();
  createTray(primaryWindow);
  if (store.getDesktopPetConfig().enabled) createPetWindow();
  app.on('activate', () => {
    focusMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || !desktopPresenceConfig.menuBarEnabled) app.quit();
});

app.on('before-quit', (event) => {
  allowWindowClose = true;
  if (shutdownReady) {
    closeResources();
    return;
  }
  if (shutdownRequested) {
    event.preventDefault();
    return;
  }
  if (activeRuns.size === 0) {
    for (const approval of pendingApprovals.values()) approval.finish(false);
    closeResources();
    return;
  }
  event.preventDefault();
  shutdownRequested = true;
  for (const run of activeRuns.values()) run.controller.abort();
  for (const approval of pendingApprovals.values()) approval.finish(false);
  void waitForActiveRuns(5_000).then(() => {
    shutdownReady = true;
    app.quit();
  });
});
