import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import type { StartupFailure } from '../app/startup-result';
import { registerRecoveryIpc } from '../ipc/register-recovery-ipc';
import { RecoveryStore } from '../storage/recovery-store';

export type RecoveryWindowOptions = {
  preloadPath: string;
  rendererHtmlPath: string;
  developmentRendererUrl?: string;
};

export function createRecoveryWindow(options: RecoveryWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 760,
    height: 720,
    minWidth: 620,
    minHeight: 560,
    show: false,
    title: '玉衡启动恢复',
    backgroundColor: '#101214',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) window.show();
  });

  if (options.developmentRendererUrl) {
    const rendererUrl = new URL(options.developmentRendererUrl);
    rendererUrl.searchParams.set('recovery', '1');
    void window.loadURL(rendererUrl.toString());
  } else {
    void window.loadFile(options.rendererHtmlPath, { query: { recovery: '1' } });
  }
  return window;
}

export type RecoveryWindowLifecycleOptions = RecoveryWindowOptions & {
  dataDirectory: string;
  logDirectory: string;
  documentsDirectory: string;
  getFailure(): StartupFailure | null;
  retry(): Promise<
    | { status: 'ready' }
    | { status: 'recovery_required'; failure: StartupFailure }
  >;
  quit(): void;
  onClosed(): void;
};

export class RecoveryWindowLifecycle {
  private window: BrowserWindow | null = null;
  private disposeIpc: (() => void) | null = null;

  constructor(private readonly options: RecoveryWindowLifecycleOptions) {}

  show(): BrowserWindow {
    const failure = this.options.getFailure();
    if (!failure) throw new Error('Recovery mode requires a startup failure.');
    if (this.window && !this.window.isDestroyed()) {
      this.window.show();
      this.window.focus();
      return this.window;
    }

    const recovery = new RecoveryStore(this.options.dataDirectory);
    const window = createRecoveryWindow(this.options);
    this.window = window;
    this.disposeIpc = registerRecoveryIpc({
      ipc: ipcMain,
      senderId: window.webContents.id,
      recovery,
      getFailure: () => {
        const current = this.options.getFailure();
        if (!current) throw new Error('Recovery status is unavailable.');
        return current;
      },
      retry: async () => {
        const result = await this.options.retry();
        if (result.status === 'ready') setImmediate(() => this.dispose());
        return result;
      },
      chooseDiagnosticTarget: async () => {
        const current = this.options.getFailure();
        if (!current) return null;
        const result = await dialog.showSaveDialog(window, {
          title: '导出玉衡启动诊断',
          defaultPath: path.join(this.options.documentsDirectory, `yuheng-diagnostic-${current.diagnosticId}.json`),
          filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        return result.canceled ? null : result.filePath ?? null;
      },
      openDirectory: async (directory) => {
        const target = directory === 'data' ? this.options.dataDirectory : this.options.logDirectory;
        const error = await shell.openPath(target);
        if (error) throw new Error('Directory could not be opened.');
      },
      quit: this.options.quit,
    });
    window.once('closed', () => this.release(window, true));
    return window;
  }

  dispose(): void {
    const window = this.window;
    this.release(window, false);
    if (window && !window.isDestroyed()) window.destroy();
  }

  private release(window: BrowserWindow | null, notifyClosed: boolean): void {
    if (!window || this.window !== window) return;
    this.disposeIpc?.();
    this.disposeIpc = null;
    this.window = null;
    if (notifyClosed) this.options.onClosed();
  }
}
