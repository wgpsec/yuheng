import { app, BrowserWindow, dialog, ipcMain, nativeImage, Notification, protocol, session, shell, type IpcMainEvent, type IpcMainInvokeEvent, type OpenDialogOptions, type WebContents } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { AppStore, type DesktopPetConfig, type DesktopPresenceConfig, type Task } from '../store';
import { SecretStore } from '../secrets';
import { TASK_ASSET_SCHEME, TaskAssetStore } from '../task-assets';
import { NOTE_COVER_SCHEME, NoteCoverStore } from '../note-covers';
import { BrowserUseSupervisor } from '../browser-use';
import { TaskReminderScheduler } from '../task-reminders';
import { BROWSER_ARTIFACT_SCHEME, BrowserArtifactStore } from '../browser-artifacts';
import { applicationVersion } from '../app-info';
import { isAgentProfileId } from '../agent-profiles';
import { testProviderConnection, type ProviderTestResult } from '../provider-test';
import { createFullBackup } from '../full-backup';
import { BackupRunAdmission } from '../backup-run-admission';
import { deleteCodexPetPackage, importCodexPetPackage, inspectCodexPets, isCodexPetRuntimeUsable, normalizePetImageSize, readCodexPetAsset, validateCodexPetManifest, type CodexPetCatalogEntry, type CodexPetManifest } from '../pets';
import { parsePetOpenTarget, PetStateCoordinator, petFeedbackForRunEvent, petFeedbackForState, type PetFeedback, type PetOpenTarget, type PetRunTarget, type PetState } from '../pet-state';
import { TaskPetReminderQueue, taskReminderFeedback } from '../task-pet-reminders';
import { IpcSenderAuthorizer } from '../ipc-security';
import { FileSecurityAuditLog } from '../security-audit';
import type { ToolPermissionMode } from '../permission-mode';
import type { ShutdownCoordinator } from '../app/shutdown-coordinator';
import type { DatabaseOwner } from '../storage/database';
import { assertText } from '../ipc/ipc-input';
import { registerAppIpc } from '../ipc/register-app-ipc';
import { registerBackupIpc } from '../ipc/register-backup-ipc';
import { registerConversationIpc } from '../ipc/register-conversation-ipc';
import { registerNoteIpc } from '../ipc/register-note-ipc';
import { registerPetIpc } from '../ipc/register-pet-ipc';
import { registerProviderIpc } from '../ipc/register-provider-ipc';
import { registerRunIpc } from '../ipc/register-run-ipc';
import { registerTaskIpc } from '../ipc/register-task-ipc';
import { SecuredIpcRegistrar } from '../ipc/secured-ipc-registrar';
import { ApprovalCoordinator } from '../runs/approval-coordinator';
import { RunCoordinator } from '../runs/run-coordinator';
import { RunExecutor, type RunEvent, type StoredAttachment } from '../runs/run-executor';
import { registerManagedProtocols } from '../protocols/register-managed-protocols';
import { MainWindowLifecycle } from '../windows/main-window';
import { TrayLifecycle } from '../windows/tray-lifecycle';
import { PetWindowLifecycle } from '../windows/pet-window';

const isDevelopment = Boolean(process.env.ELECTRON_RENDERER_URL);
export const applicationVersionValue = applicationVersion(path.resolve(__dirname, '../..'));
let store: AppStore;
let secrets: SecretStore;
let taskAssets: TaskAssetStore;
let noteCovers: NoteCoverStore;
let browserUse: BrowserUseSupervisor;
let browserArtifacts: BrowserArtifactStore;
let securityAudit: FileSecurityAuditLog;
let petWindows: PetWindowLifecycle;
let currentPetState: PetState = 'idle';
let currentPetTarget: PetRunTarget | undefined;
let currentPetFeedback: PetFeedback = petFeedbackForState('idle');
let petStateExpiryTimer: NodeJS.Timeout | undefined;
let taskReminders: TaskReminderScheduler;
const taskPetReminderQueue = new TaskPetReminderQueue();
let activeTaskPetReminderId: string | null = null;
let taskPetReminderTimer: NodeJS.Timeout | undefined;
let pendingTaskOpen: { boardId: string; taskId: string } | null = null;
let pendingPetOpen: PetOpenTarget | null = null;
const runCoordinator = new RunCoordinator();
const backupRunAdmission = new BackupRunAdmission();
const approvalCoordinator = new ApprovalCoordinator();
const sessionPermissionModes = new Map<string, ToolPermissionMode>();
const ipcSenders = new IpcSenderAuthorizer();
let normalIpc: SecuredIpcRegistrar;
let mainWindows: MainWindowLifecycle;
let trayLifecycle: TrayLifecycle;
let runExecutor: RunExecutor;
let automaticBackupTimer: NodeJS.Timeout | undefined;
let allowWindowClose = false;
let desktopPresenceConfig: DesktopPresenceConfig = { notificationsEnabled: true, menuBarEnabled: true };
type Attachment = Omit<StoredAttachment, 'data'>;
const attachments = new Map<string, StoredAttachment>();
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const allowedAttachmentTypes: Record<string, string> = {
  '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json',
  '.js': 'text/javascript', '.ts': 'text/typescript', '.py': 'text/x-python', '.html': 'text/html', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
};

const petStateCoordinator = new PetStateCoordinator({
  onStateChange: (state) => {
    currentPetState = state;
    currentPetTarget = petStateCoordinator.getFocusTarget();
    currentPetFeedback = petFeedbackForState(state, currentPetTarget);
    publishPetFeedback();
  },
});

function publishPetFeedback(): void {
  petWindows?.publish(currentPetState, currentPetFeedback);
}

function restorePetFeedbackAfterReminder(): void {
  activeTaskPetReminderId = null;
  if (taskPetReminderTimer) clearTimeout(taskPetReminderTimer);
  taskPetReminderTimer = undefined;
  currentPetState = petStateCoordinator.getState();
  currentPetTarget = petStateCoordinator.getFocusTarget();
  currentPetFeedback = petFeedbackForState(currentPetState, currentPetTarget);
  publishPetFeedback();
  schedulePetStateExpiry();
}

function showNextTaskPetReminder(): void {
  if (activeTaskPetReminderId) return;
  const task = taskPetReminderQueue.next();
  if (!task) return;
  activeTaskPetReminderId = task.id;
  currentPetState = 'attention';
  currentPetTarget = undefined;
  currentPetFeedback = taskReminderFeedback(task);
  publishPetFeedback();
  taskPetReminderTimer = setTimeout(() => {
    taskPetReminderTimer = undefined;
    if (activeTaskPetReminderId !== task.id) return;
    restorePetFeedbackAfterReminder();
    showNextTaskPetReminder();
  }, 6_000);
}

function enqueueTaskPetReminder(task: Task): void {
  if (taskPetReminderQueue.enqueue(task)) showNextTaskPetReminder();
}

function dismissTaskPetReminder(): void {
  if (!activeTaskPetReminderId) return;
  activeTaskPetReminderId = null;
  if (taskPetReminderTimer) clearTimeout(taskPetReminderTimer);
  taskPetReminderTimer = undefined;
}

function attachmentMimeType(name: string): string {
  return allowedAttachmentTypes[path.extname(name).toLowerCase()] ?? 'application/octet-stream';
}

function setPetFullscreenHidden(hidden: boolean): void {
  petWindows?.setFullscreenHidden(hidden);
}

function codexPetRoots(): Array<{ path: string; source: CodexPetManifest['source'] }> {
  return [
    { path: path.join(process.env.CODEX_HOME || path.join(homedir(), '.codex'), 'pets'), source: 'codex' },
    { path: path.join(app.getPath('userData'), 'pets'), source: 'yuheng' },
  ];
}

function blankPetFrames(manifest: CodexPetManifest, buffer: Buffer): number[] {
  try {
    const image = nativeImage.createFromBuffer(buffer);
    const size = image.getSize();
    if (size.width !== manifest.columns * manifest.cellWidth || size.height !== manifest.rows * manifest.cellHeight) return [];
    const frames = new Set<number>();
    const states = Object.values(validateCodexPetManifest(manifest).states);
    for (const state of states) {
      for (let frame = 0; frame < state.frameCount; frame += 1) {
        const frameIndex = state.row * manifest.columns + frame;
        if (frames.has(frameIndex)) continue;
        const bitmap = image.crop({ x: frame * manifest.cellWidth, y: state.row * manifest.cellHeight, width: manifest.cellWidth, height: manifest.cellHeight }).toBitmap();
        let visible = false;
        for (let offset = 3; offset < bitmap.length; offset += 4) { if (bitmap[offset] > 0) { visible = true; break; } }
        if (!visible) frames.add(frameIndex);
      }
    }
    return [...frames].sort((a, b) => a - b);
  } catch { return []; }
}

async function loadCodexPetCatalog(): Promise<CodexPetCatalogEntry[]> {
  const catalog = await inspectCodexPets(codexPetRoots());
  await Promise.all(catalog.map(async (entry) => {
    const manifest = entry.manifest;
    if (!manifest || !isCodexPetRuntimeUsable(entry)) return;
    try {
      const buffer = await readCodexPetAsset(manifest);
      const image = nativeImage.createFromBuffer(buffer);
      const size = image.getSize();
      const decodedSize = normalizePetImageSize(size);
      const report = validateCodexPetManifest(manifest, { ...(decodedSize ?? {}), blankFrameIndices: blankPetFrames(manifest, buffer) });
      const issues = [...entry.report.issues, ...report.issues].filter((item, index, all) => all.findIndex((candidate) => candidate.code === item.code && candidate.message === item.message) === index);
      entry.report = {
        ...report,
        issues,
        status: issues.some((item) => item.severity === 'error') ? 'invalid' : issues.length > 0 ? 'warning' : 'compatible',
      };
    } catch {
      // The renderer can decode WebP independently. A nativeImage failure is
      // therefore a preview/diagnostics limitation, not proof that the Codex
      // package is unusable. Keep structural errors from inspectCodexPets()
      // authoritative, but do not reject an otherwise valid package here.
      entry.report = {
        ...entry.report,
        status: entry.report.status === 'invalid' ? 'invalid' : 'warning',
        issues: [
          ...entry.report.issues,
          { code: 'manifest', severity: 'warning', message: '主进程无法预览精灵表，将由渲染器直接加载。' },
        ],
      };
    }
  }));
  return catalog;
}

function applyPetWindowConfig(config: DesktopPetConfig): void {
  petWindows?.applyConfig(config);
}

function savePetConfigPatch(patch: Partial<DesktopPetConfig>): DesktopPetConfig {
  const config = store.saveDesktopPetConfig({ ...store.getDesktopPetConfig(), ...patch });
  applyPetWindowConfig(config);
  return config;
}

function schedulePetStateExpiry(): void {
  if (petStateExpiryTimer) clearTimeout(petStateExpiryTimer);
  petStateExpiryTimer = undefined;
  const expiresAt = petStateCoordinator.nextExpiryAt();
  if (expiresAt === undefined) return;
  petStateExpiryTimer = setTimeout(() => {
    petStateExpiryTimer = undefined;
    const previousState = currentPetState;
    const previousRunId = currentPetTarget?.runId;
    const nextState = petStateCoordinator.expire();
    const nextTarget = petStateCoordinator.getFocusTarget();
    // A state change is published by the coordinator callback. Only publish
    // here when expiry changes the focused run without changing its state.
    if (nextState === previousState && nextTarget?.runId !== previousRunId) {
      currentPetTarget = nextTarget;
      currentPetFeedback = petFeedbackForState(nextState, nextTarget);
      publishPetFeedback();
    }
    schedulePetStateExpiry();
    if (petStateCoordinator.getState() === 'idle') showNextTaskPetReminder();
  }, Math.max(1, expiresAt - Date.now()));
}

export function configureRendererSecurity(): void {
  const rendererSession = session.defaultSession;
  const permitted = new Set(['clipboard-sanitized-write']);
  rendererSession.setPermissionCheckHandler((webContents, permission) => Boolean(webContents && ipcSenders.roleOf(webContents.id) === 'main' && permitted.has(permission)));
  rendererSession.setPermissionRequestHandler((webContents, permission, callback) => callback(ipcSenders.roleOf(webContents.id) === 'main' && permitted.has(permission)));
  if (!isDevelopment) {
    rendererSession.webRequest.onHeadersReceived((details, callback) => callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: yuheng-task-asset: yuheng-browser-artifact: yuheng-note-cover:; font-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'"],
      },
    }));
  }
}

function emit(sender: WebContents, event: RunEvent): void {
  dismissTaskPetReminder();
  if (!sender.isDestroyed()) sender.send('run:event', event);
  const state = petStateCoordinator.update(event);
  const nextTarget = petStateCoordinator.getFocusTarget();
  if (nextTarget?.runId === event.runId) currentPetFeedback = petFeedbackForRunEvent(event, state, nextTarget);
  else if (currentPetTarget?.runId !== nextTarget?.runId || currentPetFeedback.state !== state) currentPetFeedback = petFeedbackForState(state, nextTarget);
  currentPetState = state;
  currentPetTarget = nextTarget;
  publishPetFeedback();
  schedulePetStateExpiry();
  if (petStateCoordinator.getState() === 'idle') showNextTaskPetReminder();
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

function waitForActiveRuns(timeoutMs: number): Promise<void> {
  return runCoordinator.waitForIdle(timeoutMs);
}

function defaultBackupDirectory(): string { return path.join(app.getPath('userData'), 'backups'); }

async function runAutomaticBackup(): Promise<void> {
  if (!store || runCoordinator.size > 0) return;
  try {
    await backupRunAdmission.run(async () => {
      if (runCoordinator.size > 0) return;
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

function createWindow(): BrowserWindow {
  return mainWindows.create();
}

function mainWindow(): BrowserWindow | undefined {
  return mainWindows.get();
}

function focusMainWindow(): BrowserWindow {
  return mainWindows.focus();
}

function sendPetOpenTarget(window: BrowserWindow, target: PetOpenTarget): void {
  if (window.isDestroyed()) return;
  if (window.webContents.isLoadingMainFrame()) {
    pendingPetOpen = target;
    return;
  }
  window.webContents.send('pet:open-target', target);
}

function focusMainWindowForPet(rawTarget?: unknown): void {
  const legacyConversationId = typeof rawTarget === 'string' && rawTarget.trim() ? rawTarget.trim() : undefined;
  let target = legacyConversationId
    ? parsePetOpenTarget({ kind: 'conversation', conversationId: legacyConversationId })
    : parsePetOpenTarget(currentPetFeedback.openTarget)
      ?? (currentPetTarget?.conversationId ? parsePetOpenTarget({ kind: 'conversation', conversationId: currentPetTarget.conversationId, runId: currentPetTarget.runId }) : undefined);
  let invalidTaskTarget = false;
  if (target) {
    try {
      if (target.kind === 'task') {
        const task = store.getTask(target.taskId);
        if (task.boardId !== target.boardId) throw new Error('Task board changed.');
      } else store.getConversation(target.conversationId);
    } catch {
      invalidTaskTarget = target.kind === 'task';
      target = undefined;
    }
  }
  const window = focusMainWindow();
  if (target) sendPetOpenTarget(window, target);
  else if (invalidTaskTarget) openTaskModeFallback();
}

function openPetSettings(): void {
  const window = focusMainWindow();
  const send = () => { if (!window.isDestroyed()) window.webContents.send('pet:open-settings', 'pet'); };
  if (window.webContents.isLoadingMainFrame()) window.webContents.once('did-finish-load', send);
  else setImmediate(send);
}

function openTaskActionFromPet(action: 'open_today' | 'quick_record'): void {
  const boardId = store.listTaskBoards()[0]?.id;
  if (!boardId) return;
  const window = focusMainWindow();
  const send = () => { if (!window.isDestroyed()) window.webContents.send('task:event', { type: action, boardId }); };
  if (window.webContents.isLoadingMainFrame()) window.webContents.once('did-finish-load', send);
  else setImmediate(send);
}

function createPetWindow(): BrowserWindow {
  return petWindows.create();
}

function openTaskModeFallback(): void {
  const existingWindow = mainWindow();
  const window = existingWindow ?? createWindow();
  const boardId = store.listTaskBoards()[0]?.id;
  if (boardId) {
    if (!existingWindow || window.webContents.isLoadingMainFrame()) pendingTaskOpen = { boardId, taskId: '' };
    else window.webContents.send('task:event', { type: 'open', boardId, taskId: '' });
  }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function openTaskFromReminder(boardId: string, taskId: string): void {
  try {
    const task = store.getTask(taskId);
    if (task.boardId !== boardId) throw new Error('Task board changed.');
  } catch {
    openTaskModeFallback();
    return;
  }
  const existingWindow = mainWindow();
  const window = existingWindow ?? createWindow();
  if (!existingWindow || window.webContents.isLoadingMainFrame()) pendingTaskOpen = { boardId, taskId };
  else window.webContents.send('task:event', { type: 'open', boardId, taskId });
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

export async function initializeNormalApplication(owner: DatabaseOwner, shutdown: ShutdownCoordinator): Promise<{ primaryWindow: BrowserWindow }> {
  normalIpc = new SecuredIpcRegistrar(ipcMain, ipcSenders, (senderId) => approvalCoordinator.rejectSender(senderId));
  shutdown.register('normal-ipc', () => normalIpc.dispose());
  mainWindows = new MainWindowLifecycle({
    userDataDirectory: app.getPath('userData'),
    preloadPath: path.join(__dirname, '../preload.js'),
    rendererHtmlPath: path.join(__dirname, '../../dist-renderer/index.html'),
    developmentRendererUrl: process.env.ELECTRON_RENDERER_URL,
    registerRenderer: (window) => normalIpc.registerRenderer(window, 'main'),
    menuBarEnabled: () => desktopPresenceConfig.menuBarEnabled,
    allowClose: () => allowWindowClose,
    onFullScreenChange: setPetFullscreenHidden,
  });
  shutdown.register('main-window', () => mainWindows.dispose());
  petWindows = new PetWindowLifecycle({
    userDataDirectory: app.getPath('userData'),
    preloadPath: path.join(__dirname, '../pet-preload.js'),
    rendererHtmlPath: path.join(__dirname, '../../dist-renderer/index.html'),
    developmentRendererUrl: process.env.ELECTRON_RENDERER_URL,
    registerRenderer: (window) => normalIpc.registerRenderer(window, 'pet'),
    getConfig: () => store.getDesktopPetConfig(),
    saveConfigPatch: (patch) => store.saveDesktopPetConfig({ ...store.getDesktopPetConfig(), ...patch }),
    getMainWindow: () => mainWindow(),
    getInitialState: () => currentPetState,
    getInitialFeedback: () => currentPetFeedback,
    focusMain: () => focusMainWindowForPet(),
    openTaskAction: openTaskActionFromPet,
    openSettings: openPetSettings,
  });
  shutdown.register('pet-window', () => petWindows.dispose());
  trayLifecycle = new TrayLifecycle({
    enabled: () => desktopPresenceConfig.menuBarEnabled,
    openMainWindow: () => { focusMainWindow(); },
    quitApplication: () => { allowWindowClose = true; app.quit(); },
  });
  shutdown.register('tray', () => trayLifecycle.dispose());
  shutdown.register('pet-feedback-timers', () => {
    if (petStateExpiryTimer) clearTimeout(petStateExpiryTimer);
    petStateExpiryTimer = undefined;
    if (taskPetReminderTimer) clearTimeout(taskPetReminderTimer);
    taskPetReminderTimer = undefined;
    taskPetReminderQueue.clear();
  });
  store = AppStore.fromPreparedDatabase(owner);
  desktopPresenceConfig = store.getDesktopPresenceConfig();
  secrets = new SecretStore(app.getPath('userData'));
  taskAssets = new TaskAssetStore(path.join(app.getPath('userData'), 'task-assets'));
  noteCovers = new NoteCoverStore(path.join(app.getPath('userData'), 'note-covers'));
  browserUse = new BrowserUseSupervisor({ dataDir: path.join(app.getPath('userData'), 'browser-use') });
  shutdown.register('browser-use', () => browserUse.dispose());
  browserArtifacts = new BrowserArtifactStore(path.join(app.getPath('userData'), 'browser-use', 'screenshots'));
  securityAudit = new FileSecurityAuditLog(app.getPath('userData'));
  runExecutor = new RunExecutor({
    store,
    browserUse,
    browserArtifacts,
    securityAudit,
    runCoordinator,
    approvalCoordinator,
    userDataDirectory: app.getPath('userData'),
    applicationPath: app.getAppPath(),
    emit,
    taskChanged: handleTaskChanged,
    removeAttachment: (attachmentId) => { attachments.delete(attachmentId); },
  });
  const artifactCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  for (const artifact of store.deleteRunArtifactsBefore(artifactCutoff.toISOString())) browserArtifacts.remove(artifact.url);
  browserArtifacts.deleteFilesBefore(artifactCutoff);
  taskReminders = new TaskReminderScheduler({
    listPending: () => store.listPendingTaskReminders(),
    claim: (taskId, expectedRemindAt) => store.markTaskReminderFired(taskId, expectedRemindAt),
    notify: (task, onClick) => {
      trayLifecycle.reminderAdded();
      emitTaskChanged(task);
      enqueueTaskPetReminder(task);
      if (!desktopPresenceConfig.notificationsEnabled) return;
      const notification = new Notification({ title: '玉衡 · 任务提醒', body: task.title, silent: false });
      notification.on('click', () => { trayLifecycle.clearReminders(); onClick(); });
      notification.show();
    },
    openTask: openTaskFromReminder,
  });
  shutdown.register('task-reminders', () => taskReminders.dispose());
  shutdown.register('managed-protocols', registerManagedProtocols(protocol, [
    { scheme: TASK_ASSET_SCHEME, resolve: (url) => taskAssets.resolveUrl(url) },
    { scheme: BROWSER_ARTIFACT_SCHEME, resolve: (url) => browserArtifacts.resolveUrl(url) },
    { scheme: NOTE_COVER_SCHEME, resolve: (url) => noteCovers.resolveUrl(url) },
  ]));
  store.recoverRunningRuns();
  taskReminders.refresh();
  automaticBackupTimer = setInterval(() => { void runAutomaticBackup(); }, 60 * 60 * 1000);
  shutdown.register('automatic-backup-timer', () => {
    if (automaticBackupTimer) clearInterval(automaticBackupTimer);
    automaticBackupTimer = undefined;
  });

  registerAppIpc({
    registrar: normalIpc,
    applicationVersion: applicationVersionValue,
    platform: process.platform,
    arch: process.arch,
    openExternal: (url) => shell.openExternal(url),
    search: (query, limit) => store.search(query, limit),
    getDesktopPresence: () => desktopPresenceConfig,
    saveDesktopPresence: (raw) => {
      if (!raw || typeof raw !== 'object') throw new Error('无效的通知设置。');
      const input = raw as Record<string, unknown>;
      desktopPresenceConfig = store.saveDesktopPresenceConfig({ notificationsEnabled: input.notificationsEnabled !== false, menuBarEnabled: input.menuBarEnabled !== false });
      if (desktopPresenceConfig.menuBarEnabled) trayLifecycle.create();
      else trayLifecycle.dispose();
      return desktopPresenceConfig;
    },
  });

  registerConversationIpc({
    registrar: normalIpc,
    store,
    isConversationActive: (conversationId) => runCoordinator.hasActiveConversation(conversationId),
    onConversationDeleted: (conversationId) => {
      sessionPermissionModes.delete(conversationId);
      return fs.rm(path.join(app.getPath('userData'), 'pi-agent', 'sessions', conversationId), { recursive: true, force: true });
    },
  });
  registerNoteIpc({ registrar: normalIpc, store, covers: noteCovers, attachmentMimeType });
  registerBackupIpc({
    registrar: normalIpc,
    store,
    secrets,
    admission: backupRunAdmission,
    dataDirectory: app.getPath('userData'),
    documentsDirectory: app.getPath('documents'),
    applicationVersion: applicationVersionValue,
    platform: process.platform,
    arch: process.arch,
    defaultDirectory: defaultBackupDirectory,
    waitForIdle: waitForActiveRuns,
    hasActiveRuns: () => runCoordinator.size > 0,
    runAutomaticBackup,
  });
  const getPet = (): DesktopPetConfig => store.getDesktopPetConfig();
  const listPets = async (): Promise<CodexPetManifest[]> => (await loadCodexPetCatalog()).flatMap((entry) => isCodexPetRuntimeUsable(entry) ? [entry.manifest!] : []);
  const petCatalog = async (): Promise<CodexPetCatalogEntry[]> => loadCodexPetCatalog();
  const getPetAsset = async (rawPetId: unknown) => {
    if (typeof rawPetId !== 'string' || !rawPetId.trim()) return null;
    const manifests = (await loadCodexPetCatalog()).flatMap((entry) => isCodexPetRuntimeUsable(entry) ? [entry.manifest!] : []);
    const manifest = manifests.find((item) => item.id === rawPetId.trim());
    if (!manifest) return null;
    const buffer = await readCodexPetAsset(manifest);
    const size = nativeImage.createFromBuffer(buffer).getSize();
    if ((size.width > 0 || size.height > 0) && (size.width !== manifest.columns * manifest.cellWidth || size.height !== manifest.rows * manifest.cellHeight)) {
      throw new Error('宠物精灵表尺寸与 Codex Pet 规范不匹配。');
    }
    return { manifest, dataUrl: `data:image/webp;base64,${buffer.toString('base64')}` };
  };
  const importPet = async (): Promise<CodexPetManifest | null> => {
    const owner = mainWindow();
    const result = owner
      ? await dialog.showOpenDialog(owner, { properties: ['openFile'], filters: [{ name: '玉衡 Pet manifest', extensions: ['json'] }] })
      : await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: '玉衡 Pet manifest', extensions: ['json'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    if (path.basename(result.filePaths[0]).toLowerCase() !== 'pet.json') throw new Error('请选择皮肤目录中的 pet.json。');
    return importCodexPetPackage(path.dirname(result.filePaths[0]), path.join(app.getPath('userData'), 'pets'));
  };
  const deletePet = async (rawPetId: unknown): Promise<void> => {
    if (typeof rawPetId !== 'string') throw new Error('皮肤标识无效。');
    await deleteCodexPetPackage(rawPetId, codexPetRoots().map((root) => root.path), store.getDesktopPetConfig().petId);
  };
  const revealPet = async (rawPetId: unknown): Promise<void> => {
    if (typeof rawPetId !== 'string' || !rawPetId.trim()) throw new Error('皮肤标识无效。');
    const entry = (await loadCodexPetCatalog()).find((item) => item.id === rawPetId.trim() && item.manifest);
    if (!entry?.manifest) throw new Error('找不到该皮肤。');
    shell.showItemInFolder(path.join(entry.manifest.rootPath, 'pet.json'));
  };
  const openPetFolder = async () => {
    const folder = path.join(process.env.CODEX_HOME || path.join(homedir(), '.codex'), 'pets');
    await fs.mkdir(folder, { recursive: true });
    const error = await shell.openPath(folder);
    if (error) throw new Error(error);
  };
  const savePet = (raw: unknown): DesktopPetConfig => {
    if (!raw || typeof raw !== 'object' || typeof (raw as Record<string, unknown>).enabled !== 'boolean') {
      throw new Error('无效的桌面宠物设置。');
    }
    const input = raw as Record<string, unknown>;
    const scale = typeof input.scale === 'number' && Number.isFinite(input.scale) ? Math.min(1.4, Math.max(0.8, input.scale)) : undefined;
    const opacity = typeof input.opacity === 'number' && Number.isFinite(input.opacity) ? Math.min(1, Math.max(0.2, input.opacity)) : undefined;
    const feedbackMode = input.feedbackMode === 'important' || input.feedbackMode === 'all' || input.feedbackMode === 'hidden' ? input.feedbackMode : undefined;
    const mutedUntil = typeof input.mutedUntil === 'number' && Number.isFinite(input.mutedUntil) && input.mutedUntil > 0 ? input.mutedUntil : undefined;
    const config = store.saveDesktopPetConfig({
      enabled: input.enabled === true,
      ...(typeof input.petId === 'string' ? { petId: input.petId } : {}),
      ...(scale !== undefined ? { scale } : {}),
      ...(typeof input.locked === 'boolean' ? { locked: input.locked } : {}),
      ...(opacity !== undefined ? { opacity } : {}),
      ...(typeof input.alwaysOnTop === 'boolean' ? { alwaysOnTop: input.alwaysOnTop } : {}),
      ...(typeof input.edgeSnap === 'boolean' ? { edgeSnap: input.edgeSnap } : {}),
      ...(typeof input.inertia === 'boolean' ? { inertia: input.inertia } : {}),
      ...(typeof input.boundaryBounce === 'boolean' ? { boundaryBounce: input.boundaryBounce } : {}),
      ...(feedbackMode ? { feedbackMode } : {}),
      ...(typeof input.completionFeedback === 'boolean' ? { completionFeedback: input.completionFeedback } : {}),
      ...(typeof input.errorFeedback === 'boolean' ? { errorFeedback: input.errorFeedback } : {}),
      ...(typeof input.approvalFeedback === 'boolean' ? { approvalFeedback: input.approvalFeedback } : {}),
      ...(typeof input.soundEnabled === 'boolean' ? { soundEnabled: input.soundEnabled } : {}),
      ...(mutedUntil !== undefined ? { mutedUntil } : {}),
    });
    applyPetWindowConfig(config);
    if (config.enabled) createPetWindow();
    else petWindows.close();
    return config;
  };
  const takePetOpenTarget = () => {
    const target = pendingPetOpen;
    pendingPetOpen = null;
    return target;
  };
  const startPetDrag = (event: IpcMainEvent, rawScreenX: unknown, rawScreenY: unknown) => {
    petWindows.startDrag(event.sender, rawScreenX, rawScreenY);
  };
  const movePetDrag = (event: IpcMainEvent, rawScreenX: unknown, rawScreenY: unknown) => {
    petWindows.moveDrag(event.sender, rawScreenX, rawScreenY);
  };
  const endPetDrag = (event: IpcMainEvent) => {
    petWindows.endDrag(event.sender);
  };
  registerPetIpc({
    registrar: normalIpc,
    get: getPet,
    list: listPets,
    catalog: petCatalog,
    asset: getPetAsset,
    importPet,
    deletePet,
    revealPet,
    openFolder: openPetFolder,
    save: savePet,
    focusMain: focusMainWindowForPet,
    takeOpenTarget: takePetOpenTarget,
    dragStart: startPetDrag,
    dragMove: movePetDrag,
    dragEnd: endPetDrag,
  });
  registerTaskIpc({
    registrar: normalIpc,
    store,
    assets: taskAssets,
    takePendingOpen: () => { const request = pendingTaskOpen; pendingTaskOpen = null; return request; },
    taskChanged: handleTaskChanged,
    taskTypesChanged: emitTaskTypesChanged,
    taskBoardsChanged: emitTaskBoardsChanged,
    attachmentMimeType,
  });
  registerProviderIpc({ registrar: normalIpc, store, secrets, browserUse });
  const pickAttachments = async (event: IpcMainInvokeEvent) => {
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
  };
  const releaseAttachments = (attachmentIds: unknown) => {
    if (!Array.isArray(attachmentIds)) return;
    attachmentIds.forEach((id) => { if (typeof id === 'string') attachments.delete(id); });
  };
  const startRun = (event: IpcMainInvokeEvent, conversationId: unknown, content: unknown, attachmentIds: unknown, rawReasoningLevel: unknown) => {
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
    if (runCoordinator.hasActiveConversation(id)) throw new Error('该会话仍在处理中。');
    const runId = crypto.randomUUID();
    const reasoningLevel = rawReasoningLevel == null ? undefined : (() => {
      if (rawReasoningLevel === 'off' || rawReasoningLevel === 'low' || rawReasoningLevel === 'medium' || rawReasoningLevel === 'high' || rawReasoningLevel === 'xhigh' || rawReasoningLevel === 'max') return rawReasoningLevel;
      throw new Error('不支持的推理级别。');
    })();
    const userMessage = store.addMessage(id, 'user', text);
    store.startRun(runId, id, userMessage.id);
    const controller = new AbortController();
    const permissionMode = sessionPermissionModes.get(id) ?? store.getToolPermissionMode(id);
    runCoordinator.start(runId, { controller, conversationId: id, inputMessageId: userMessage.id, permissionMode });
    emit(event.sender, { type: 'accepted', runId, conversationId: id });
    setImmediate(() => { void runExecutor.execute(event.sender, runId, id, config, apiKey, runAttachments, reasoningLevel); });
    return { runId, userMessage, conversation: store.getConversation(id) };
  };
  const retryRun = (event: IpcMainInvokeEvent, conversationId: unknown, inputMessageId: unknown, content: unknown, rawReasoningLevel: unknown) => {
    const id = assertText(conversationId, 'conversationId');
    backupRunAdmission.assertRunAllowed();
    const messageId = assertText(inputMessageId, 'inputMessageId');
    const text = assertText(content, 'content');
    const providerId = store.getConversationProviderId(id);
    const config = providerId ? store.getProvider(providerId) : null;
    const apiKey = providerId ? secrets.getProviderKey(providerId) : null;
    if (!config || !apiKey) throw new Error('请先配置 Provider 和 API Key。');
    if (runCoordinator.hasActiveConversation(id)) throw new Error('该会话仍在处理中。');
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
    const permissionMode = sessionPermissionModes.get(id) ?? store.getToolPermissionMode(id);
    runCoordinator.start(runId, { controller, conversationId: id, inputMessageId: userMessage.id, permissionMode, replayUser });
    emit(event.sender, { type: 'accepted', runId, conversationId: id });
    setImmediate(() => { void runExecutor.execute(event.sender, runId, id, config, apiKey, [], reasoningLevel); });
    return { runId, userMessage, conversation: store.getConversation(id) };
  };
  registerRunIpc({
    registrar: normalIpc,
    store,
    getPermissionMode: (conversationId) => sessionPermissionModes.get(conversationId) ?? store.getToolPermissionMode(conversationId),
    savePermissionMode: (conversationId, mode) => {
      if (mode === 'full_session') { sessionPermissionModes.set(conversationId, mode); return mode; }
      sessionPermissionModes.delete(conversationId);
      return store.saveToolPermissionMode(conversationId, mode);
    },
    pickAttachments,
    releaseAttachments,
    start: startRun,
    retry: retryRun,
    cancel: (runId) => runCoordinator.cancel(runId),
    approve: (senderId, approvalId, approved) => approvalCoordinator.resolve(approvalId, senderId, approved),
  });

  const primaryWindow = createWindow();
  trayLifecycle.create();
  if (store.getDesktopPetConfig().enabled) createPetWindow();
  const activate = () => { focusMainWindow(); };
  app.on('activate', activate);
  shutdown.register('application-activate-listener', () => { app.removeListener('activate', activate); });
  return { primaryWindow };
}

export function shouldKeepApplicationAliveWithoutWindows(): boolean {
  return process.platform === 'darwin' && desktopPresenceConfig.menuBarEnabled;
}

export function prepareNormalApplicationShutdown(): void {
  allowWindowClose = true;
  petWindows?.prepareForShutdown();
  runCoordinator.cancelAll();
  approvalCoordinator.close();
}

export async function waitForNormalApplicationShutdown(timeoutMs: number): Promise<boolean> {
  await runCoordinator.waitForIdle(timeoutMs);
  return runCoordinator.size === 0;
}
