import { BrowserWindow } from 'electron';

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
