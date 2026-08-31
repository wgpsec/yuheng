import { BrowserWindow, screen, shell, type Rectangle } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { externalHttpUrl } from '../external-links';

const DEFAULT_BOUNDS: Rectangle = { x: 0, y: 0, width: 1440, height: 920 };
const MIN_WIDTH = 980;
const MIN_HEIGHT = 640;

export type MainWindowOptions = {
  userDataDirectory: string;
  preloadPath: string;
  rendererHtmlPath: string;
  developmentRendererUrl?: string;
  registerRenderer(window: BrowserWindow): void;
  menuBarEnabled(): boolean;
  allowClose(): boolean;
  onFullScreenChange(fullScreen: boolean): void;
};

export class MainWindowLifecycle {
  private window: BrowserWindow | null = null;

  constructor(private readonly options: MainWindowOptions) {}

  create(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const bounds = this.visibleBounds(this.loadBounds());
    const window = new BrowserWindow({
      ...bounds,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      title: '玉衡',
      backgroundColor: '#101214',
      ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 16 } } : {}),
      webPreferences: { preload: this.options.preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    this.window = window;
    this.options.registerRenderer(window);
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.setWindowOpenHandler(({ url }) => {
      const externalUrl = externalHttpUrl(url);
      if (externalUrl) void shell.openExternal(externalUrl);
      return { action: 'deny' };
    });

    let saveTimer: NodeJS.Timeout | undefined;
    const scheduleBoundsSave = () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { saveTimer = undefined; this.saveBounds(window); }, 250);
    };
    window.on('resize', scheduleBoundsSave);
    window.on('move', scheduleBoundsSave);
    window.on('enter-full-screen', () => { window.webContents.send('window:fullscreen', true); this.options.onFullScreenChange(true); });
    window.on('leave-full-screen', () => { window.webContents.send('window:fullscreen', false); this.options.onFullScreenChange(false); });
    window.on('close', (event) => {
      if (!this.options.allowClose() && process.platform === 'darwin' && this.options.menuBarEnabled()) {
        event.preventDefault(); window.hide(); return;
      }
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = undefined;
      this.saveBounds(window);
    });
    window.once('closed', () => { if (this.window === window) this.window = null; });

    if (this.options.developmentRendererUrl) {
      void window.loadURL(this.options.developmentRendererUrl);
      window.webContents.openDevTools({ mode: 'detach' });
    } else {
      void window.loadFile(this.options.rendererHtmlPath);
    }
    return window;
  }

  get(): BrowserWindow | undefined {
    return this.window && !this.window.isDestroyed() ? this.window : undefined;
  }

  focus(): BrowserWindow {
    const window = this.get() ?? this.create();
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    return window;
  }

  dispose(): void {
    const window = this.window;
    this.window = null;
    if (window && !window.isDestroyed()) window.destroy();
  }

  private statePath(): string {
    return path.join(this.options.userDataDirectory, 'window-state.json');
  }

  private loadBounds(): Partial<Rectangle> | undefined {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.statePath(), 'utf8'));
      if (!parsed || typeof parsed !== 'object') return undefined;
      const state = parsed as Record<string, unknown>;
      const bounds: Partial<Rectangle> = {};
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        const value = typeof state[key] === 'number' && Number.isFinite(state[key]) ? Math.round(state[key]) : undefined;
        if (value !== undefined) bounds[key] = value;
      }
      return bounds.width === undefined || bounds.height === undefined ? undefined : bounds;
    } catch { return undefined; }
  }

  private visibleBounds(saved: Partial<Rectangle> | undefined): Rectangle {
    const displays = screen.getAllDisplays();
    const display = saved?.x !== undefined && saved?.y !== undefined
      ? displays.find((candidate) => saved.x! >= candidate.bounds.x && saved.x! < candidate.bounds.x + candidate.bounds.width && saved.y! >= candidate.bounds.y && saved.y! < candidate.bounds.y + candidate.bounds.height) ?? screen.getPrimaryDisplay()
      : screen.getPrimaryDisplay();
    const area = display.workArea;
    const width = Math.min(Math.max(saved?.width ?? DEFAULT_BOUNDS.width, MIN_WIDTH), area.width);
    const height = Math.min(Math.max(saved?.height ?? DEFAULT_BOUNDS.height, MIN_HEIGHT), area.height);
    const x = saved?.x ?? area.x + Math.round((area.width - width) / 2);
    const y = saved?.y ?? area.y + Math.round((area.height - height) / 2);
    return { x: Math.min(Math.max(x, area.x), area.x + area.width - width), y: Math.min(Math.max(y, area.y), area.y + area.height - height), width, height };
  }

  private saveBounds(window: BrowserWindow): void {
    if (window.isDestroyed() || window.isMaximized() || window.isFullScreen()) return;
    const bounds = window.getBounds();
    const filePath = this.statePath();
    const temporaryPath = `${filePath}.tmp`;
    try {
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(temporaryPath, JSON.stringify({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }), 'utf8');
      renameSync(temporaryPath, filePath);
    } catch {
      // Window preferences are best effort.
    }
  }
}
