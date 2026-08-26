import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions, type WebContents } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AppStore, type ProviderConfig } from './store';
import { SecretStore } from './secrets';
import { createPiRuntime, createPiSessionFactory } from './pi-runtime';

const isDevelopment = Boolean(process.env.ELECTRON_RENDERER_URL);
let store: AppStore;
let secrets: SecretStore;
const activeRuns = new Map<string, { controller: AbortController; conversationId: string }>();
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

type RunEvent =
  | { type: 'accepted'; runId: string; conversationId: string }
  | { type: 'delta'; runId: string; conversationId: string; messageId: string; delta: string }
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

async function executeRun(sender: WebContents, runId: string, conversationId: string, config: ProviderConfig, apiKey: string, runAttachments: StoredAttachment[]): Promise<void> {
  const run = activeRuns.get(runId);
  if (!run) return;
  const assistantMessageId = crypto.randomUUID();
  let assistantCreated = false;
  let assistantContent = '';
  const runtime = createPiRuntime({ sessionFactory: createPiSessionFactory(config, apiKey, { agentDir: path.join(app.getPath('userData'), 'pi-agent') }) });
  try {
    const workspaceDir = path.join(app.getPath('userData'), 'workspace');
    await fs.mkdir(workspaceDir, { recursive: true });
    const messages = store.listMessages(conversationId).map(({ role, content }) => ({ role, content }));
    const prompt = messages.map((message) => `${message.role === 'user' ? '用户' : '玉衡'}：${message.content}`).join('\n\n');
    const images = runAttachments.filter((attachment) => attachment.mimeType.startsWith('image/')).map((attachment) => ({ type: 'image' as const, data: Buffer.from(attachment.data).toString('base64'), mimeType: attachment.mimeType }));
    const textAttachments = runAttachments.filter((attachment) => !attachment.mimeType.startsWith('image/')).map((attachment) => `\n[附件：${attachment.name}]\n${Buffer.from(attachment.data).toString('utf8')}\n[/附件]`).join('');
    await runtime.start({
      prompt: `${prompt || '请查看附件并回复。'}${textAttachments}`,
      images,
      sessionId: conversationId,
      cwd: workspaceDir,
      signal: run.controller.signal,
      emit: (event) => {
        if (event.type !== 'text_delta') return;
        const delta = event.delta;
        if (!assistantCreated) {
          store.addMessage(conversationId, 'assistant', '', assistantMessageId);
          assistantCreated = true;
        }
        assistantContent += delta;
        store.updateMessage(assistantMessageId, assistantContent);
        emit(sender, { type: 'delta', runId, conversationId, messageId: assistantMessageId, delta });
      },
    });
    if (run.controller.signal.aborted) {
      if (!assistantCreated) store.addMessage(conversationId, 'assistant', '', assistantMessageId);
      store.finishRun(runId, 'cancelled');
      emit(sender, { type: 'cancelled', runId, conversationId });
      return;
    }
    if (!assistantCreated) store.addMessage(conversationId, 'assistant', '', assistantMessageId);
    store.finishRun(runId, 'completed');
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
    runtime.dispose();
    for (const attachment of runAttachments) attachments.delete(attachment.id);
    activeRuns.delete(runId);
  }
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 640,
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

  if (isDevelopment) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL as string);
    window.webContents.openDevTools({ mode: 'detach' });
  } else {
    void window.loadFile(path.join(__dirname, '../dist-renderer/index.html'));
  }
}

app.whenReady().then(() => {
  store = new AppStore(app.getPath('userData'));
  secrets = new SecretStore(app.getPath('userData'));
  store.recoverRunningRuns();

  ipcMain.handle('app:get-info', () => ({
    name: 'yuheng',
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  }));

  ipcMain.handle('conversations:list', () => store.listConversations());
  ipcMain.handle('conversations:messages', (_event, conversationId: unknown) => store.listMessages(assertText(conversationId, 'conversationId')));
  ipcMain.handle('conversations:create', (_event, title: unknown) => store.createConversation(typeof title === 'string' && title.trim() ? title.trim() : undefined));
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
  ipcMain.handle('runs:start', (event, conversationId: unknown, content: unknown, attachmentIds: unknown) => {
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
    const userMessage = store.addMessage(id, 'user', text);
    store.startRun(runId, id, userMessage.id);
    const controller = new AbortController();
    activeRuns.set(runId, { controller, conversationId: id });
    emit(event.sender, { type: 'accepted', runId, conversationId: id });
    setImmediate(() => { void executeRun(event.sender, runId, id, config, apiKey, runAttachments); });
    return { runId, userMessage };
  });
  ipcMain.handle('runs:cancel', (_event, runId: unknown) => {
    const run = activeRuns.get(assertText(runId, 'runId'));
    if (run) run.controller.abort();
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
  store?.close();
});
