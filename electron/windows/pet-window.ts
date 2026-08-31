import { BrowserWindow, Menu, screen, type WebContents } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  clampPetPosition,
  restorePetPosition,
  snapPetPosition,
  stepPetInertia,
  type PetDisplay,
  type PetPoint,
  type StoredPetPositions,
} from '../pet-desktop-behavior';
import type { PetFeedback, PetState } from '../pet-state';
import type { DesktopPetConfig } from '../store';

const PET_STATE_FILE = 'desktop-pet-state.json';
const PET_WINDOW_SIZE = 188;

type PetDragState = {
  senderId: number;
  pointerX: number;
  pointerY: number;
  windowX: number;
  windowY: number;
  lastX: number;
  lastY: number;
  lastAt: number;
  velocityX: number;
  velocityY: number;
};

export type PetWindowLifecycleOptions = {
  userDataDirectory: string;
  preloadPath: string;
  rendererHtmlPath: string;
  developmentRendererUrl?: string;
  registerRenderer(window: BrowserWindow): void;
  getConfig(): DesktopPetConfig;
  saveConfigPatch(patch: Partial<DesktopPetConfig>): DesktopPetConfig;
  getMainWindow(): BrowserWindow | undefined;
  getInitialState(): PetState;
  getInitialFeedback(): PetFeedback;
  focusMain(): void;
  openTaskAction(action: 'open_today' | 'quick_record'): void;
  openSettings(): void;
};

export class PetWindowLifecycle {
  private window: BrowserWindow | null = null;
  private dragState: PetDragState | null = null;
  private motionTimer: NodeJS.Timeout | undefined;
  private hiddenForFullscreen = false;
  private trackingDisplays = false;
  private readonly displayChanged = () => this.relocateAfterDisplayChange();

  constructor(private readonly options: PetWindowLifecycleOptions) {}

  create(): BrowserWindow {
    const existing = this.get();
    if (existing) return existing;
    const position = this.visiblePosition(this.loadPosition());
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
        preload: this.options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.window = window;
    this.startDisplayTracking();
    this.options.registerRenderer(window);
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.applyConfig(this.options.getConfig());

    let saveTimer: NodeJS.Timeout | undefined;
    const scheduleSave = () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { saveTimer = undefined; this.savePosition(window); }, 250);
    };
    window.on('move', scheduleSave);
    window.on('close', () => {
      this.cancelMotion();
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = undefined;
      this.savePosition(window);
    });
    window.on('closed', () => {
      this.cancelMotion();
      if (this.window === window) this.window = null;
      this.dragState = null;
      this.hiddenForFullscreen = false;
    });

    if (this.options.developmentRendererUrl) {
      const rendererUrl = new URL(this.options.developmentRendererUrl);
      rendererUrl.searchParams.set('pet', '1');
      void window.loadURL(rendererUrl.toString());
    } else {
      void window.loadFile(this.options.rendererHtmlPath, { query: { pet: '1' } });
    }
    window.webContents.on('did-finish-load', () => {
      if (window.isDestroyed()) return;
      window.webContents.send('pet:state', this.options.getInitialState());
      window.webContents.send('pet:config', this.options.getConfig());
      window.webContents.send('pet:feedback', this.options.getInitialFeedback());
    });
    window.webContents.on('context-menu', (event) => {
      event.preventDefault();
      if (window.isDestroyed()) return;
      const config = this.options.getConfig();
      Menu.buildFromTemplate([
        { label: '打开玉衡', click: this.options.focusMain },
        { label: window.isVisible() ? '隐藏桌面 Pet' : '显示桌面 Pet', click: () => { if (window.isVisible()) window.hide(); else window.showInactive(); } },
        { type: 'separator' },
        { label: '锁定位置', type: 'checkbox', checked: config.locked === true, click: (item) => this.saveConfig({ locked: item.checked }) },
        { label: '始终置顶', type: 'checkbox', checked: config.alwaysOnTop !== false, click: (item) => this.saveConfig({ alwaysOnTop: item.checked }) },
        { label: '回到默认位置', click: () => { const next = this.visiblePosition(undefined); window.setPosition(next.x, next.y); this.savePosition(window); } },
        { type: 'separator' },
        { label: '今日任务', click: () => this.options.openTaskAction('open_today') },
        { label: '快速记录', click: () => this.options.openTaskAction('quick_record') },
        { type: 'separator' },
        { label: '打开 Pet 设置', click: this.options.openSettings },
        { label: '关闭桌面 Pet', click: () => this.saveConfig({ enabled: false }) },
      ]).popup({ window });
    });
    window.once('ready-to-show', () => {
      if (window.isDestroyed()) return;
      const main = this.options.getMainWindow();
      if (main?.isFullScreen()) { this.hiddenForFullscreen = true; return; }
      window.showInactive();
    });
    return window;
  }

  get(): BrowserWindow | undefined {
    return this.window && !this.window.isDestroyed() ? this.window : undefined;
  }

  publish(state: PetState, feedback: PetFeedback): void {
    const window = this.get();
    if (!window) return;
    window.webContents.send('pet:state', state);
    window.webContents.send('pet:feedback', feedback);
  }

  applyConfig(config: DesktopPetConfig): void {
    const window = this.get();
    if (!window) return;
    if (config.locked === true) {
      this.cancelMotion();
      this.dragState = null;
    }
    if (config.alwaysOnTop === false) window.setAlwaysOnTop(false);
    else window.setAlwaysOnTop(true, 'floating');
    window.setOpacity(this.opacity(config));
    window.webContents.send('pet:config', config);
  }

  close(): void {
    this.get()?.close();
  }

  dispose(): void {
    const window = this.window;
    this.window = null;
    this.dragState = null;
    this.hiddenForFullscreen = false;
    this.cancelMotion();
    if (this.trackingDisplays) {
      screen.removeListener('display-added', this.displayChanged);
      screen.removeListener('display-removed', this.displayChanged);
      screen.removeListener('display-metrics-changed', this.displayChanged);
      this.trackingDisplays = false;
    }
    if (window && !window.isDestroyed()) window.destroy();
  }

  prepareForShutdown(): void {
    this.dragState = null;
    this.cancelMotion();
  }

  setFullscreenHidden(hidden: boolean): void {
    const window = this.get();
    if (!window) return;
    if (hidden) {
      if (!window.isVisible()) return;
      this.hiddenForFullscreen = true;
      this.cancelMotion();
      window.hide();
      return;
    }
    if (!this.hiddenForFullscreen) return;
    this.hiddenForFullscreen = false;
    if (this.options.getConfig().enabled) window.showInactive();
  }

  relocateAfterDisplayChange(): void {
    const window = this.get();
    if (!window) return;
    const position = this.visiblePosition(this.loadPosition());
    window.setPosition(position.x, position.y);
    this.savePosition(window);
  }

  startDrag(sender: WebContents, rawScreenX: unknown, rawScreenY: unknown): void {
    const window = this.get();
    if (!window || sender !== window.webContents || this.options.getConfig().locked === true) return;
    this.cancelMotion();
    const pointerX = this.finiteNumber(rawScreenX);
    const pointerY = this.finiteNumber(rawScreenY);
    if (pointerX === undefined || pointerY === undefined) return;
    const [windowX, windowY] = window.getPosition();
    this.dragState = {
      senderId: sender.id,
      pointerX,
      pointerY,
      windowX,
      windowY,
      lastX: pointerX,
      lastY: pointerY,
      lastAt: Date.now(),
      velocityX: 0,
      velocityY: 0,
    };
  }

  moveDrag(sender: WebContents, rawScreenX: unknown, rawScreenY: unknown): void {
    const drag = this.dragState;
    const window = this.get();
    if (!drag || drag.senderId !== sender.id || !window || sender !== window.webContents) return;
    const pointerX = this.finiteNumber(rawScreenX);
    const pointerY = this.finiteNumber(rawScreenY);
    if (pointerX === undefined || pointerY === undefined) return;
    const now = Date.now();
    const elapsed = Math.max(8, now - drag.lastAt);
    const rawVelocityX = (pointerX - drag.lastX) / elapsed * 16;
    const rawVelocityY = (pointerY - drag.lastY) / elapsed * 16;
    drag.velocityX = drag.velocityX * 0.55 + Math.max(-80, Math.min(80, rawVelocityX)) * 0.45;
    drag.velocityY = drag.velocityY * 0.55 + Math.max(-80, Math.min(80, rawVelocityY)) * 0.45;
    drag.lastX = pointerX;
    drag.lastY = pointerY;
    drag.lastAt = now;
    const position = this.visiblePosition({
      x: Math.round(drag.windowX + pointerX - drag.pointerX),
      y: Math.round(drag.windowY + pointerY - drag.pointerY),
    });
    window.setPosition(position.x, position.y);
  }

  endDrag(sender: WebContents): void {
    const drag = this.dragState;
    if (!drag || drag.senderId !== sender.id) return;
    this.dragState = null;
    const window = this.get();
    if (!window) return;
    const config = this.options.getConfig();
    if (config.locked === true) { this.savePosition(window); return; }
    const display = this.displayForWindow(window);
    const [x, y] = window.getPosition();
    const finalPosition = config.edgeSnap === true
      ? snapPetPosition({ x, y }, display, { width: PET_WINDOW_SIZE, height: PET_WINDOW_SIZE })
      : clampPetPosition({ x, y }, display, { width: PET_WINDOW_SIZE, height: PET_WINDOW_SIZE });
    window.setPosition(finalPosition.x, finalPosition.y);
    if (config.inertia === true && Math.hypot(drag.velocityX, drag.velocityY) >= 0.5) {
      this.startInertia(window, { x: drag.velocityX, y: drag.velocityY }, config.boundaryBounce === true);
    } else this.savePosition(window);
  }

  private saveConfig(patch: Partial<DesktopPetConfig>): void {
    this.applyConfig(this.options.saveConfigPatch(patch));
  }

  private startDisplayTracking(): void {
    if (this.trackingDisplays) return;
    this.trackingDisplays = true;
    screen.on('display-added', this.displayChanged);
    screen.on('display-removed', this.displayChanged);
    screen.on('display-metrics-changed', this.displayChanged);
  }

  private opacity(config: DesktopPetConfig): number {
    return typeof config.opacity === 'number' && Number.isFinite(config.opacity)
      ? Math.min(1, Math.max(0.2, config.opacity))
      : 1;
  }

  private finiteNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  private statePath(): string {
    return path.join(this.options.userDataDirectory, PET_STATE_FILE);
  }

  private loadPosition(): StoredPetPositions | undefined {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.statePath(), 'utf8'));
      if (!parsed || typeof parsed !== 'object') return undefined;
      const state = parsed as Record<string, unknown>;
      if (state.version === 1 && state.byDisplay && typeof state.byDisplay === 'object') {
        const byDisplay: Record<string, PetPoint> = {};
        for (const [displayId, value] of Object.entries(state.byDisplay as Record<string, unknown>)) {
          if (!value || typeof value !== 'object') continue;
          const x = this.finiteNumber((value as Record<string, unknown>).x);
          const y = this.finiteNumber((value as Record<string, unknown>).y);
          if (x !== undefined && y !== undefined) byDisplay[displayId] = { x: Math.round(x), y: Math.round(y) };
        }
        const lastDisplayId = typeof state.lastDisplayId === 'string' && state.lastDisplayId ? state.lastDisplayId : undefined;
        return { version: 1, byDisplay, ...(lastDisplayId ? { lastDisplayId } : {}) };
      }
      const x = this.finiteNumber(state.x);
      const y = this.finiteNumber(state.y);
      return x !== undefined && y !== undefined ? { x: Math.round(x), y: Math.round(y) } : undefined;
    } catch { return undefined; }
  }

  private displays(): PetDisplay[] {
    const primaryId = String(screen.getPrimaryDisplay().id);
    return screen.getAllDisplays().map((display) => ({
      id: String(display.id),
      primary: String(display.id) === primaryId,
      bounds: { x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height },
      workArea: { x: display.workArea.x, y: display.workArea.y, width: display.workArea.width, height: display.workArea.height },
    }));
  }

  private visiblePosition(saved: StoredPetPositions | undefined): PetPoint {
    return restorePetPosition(saved, this.displays(), { width: PET_WINDOW_SIZE, height: PET_WINDOW_SIZE }).position;
  }

  private displayForWindow(window: BrowserWindow): PetDisplay {
    const display = screen.getDisplayMatching(window.getBounds());
    return {
      id: String(display.id),
      primary: String(display.id) === String(screen.getPrimaryDisplay().id),
      bounds: { x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height },
      workArea: { x: display.workArea.x, y: display.workArea.y, width: display.workArea.width, height: display.workArea.height },
    };
  }

  private savePosition(window: BrowserWindow): void {
    if (window.isDestroyed()) return;
    const [x, y] = window.getPosition();
    const display = this.displayForWindow(window);
    const filePath = this.statePath();
    const temporaryPath = `${filePath}.tmp`;
    try {
      mkdirSync(path.dirname(filePath), { recursive: true });
      const loaded = this.loadPosition();
      const byDisplay = loaded && 'version' in loaded && loaded.version === 1 ? { ...loaded.byDisplay } : {};
      const legacy = loaded && !('version' in loaded) ? loaded : undefined;
      if (legacy && !byDisplay[String(display.id)]) byDisplay[String(display.id)] = legacy;
      byDisplay[String(display.id)] = { x, y };
      writeFileSync(temporaryPath, JSON.stringify({ version: 1, lastDisplayId: display.id, byDisplay }), 'utf8');
      renameSync(temporaryPath, filePath);
    } catch {
      // Position persistence is best effort and must not block shutdown.
    }
  }

  private cancelMotion(): void {
    if (this.motionTimer) clearTimeout(this.motionTimer);
    this.motionTimer = undefined;
  }

  private startInertia(window: BrowserWindow, velocity: PetPoint, bounce: boolean): void {
    this.cancelMotion();
    const [windowX, windowY] = window.getPosition();
    let current: PetPoint = { x: windowX, y: windowY };
    let nextVelocity = velocity;
    let steps = 0;
    const tick = () => {
      if (window.isDestroyed() || steps >= 24) {
        this.motionTimer = undefined;
        if (!window.isDestroyed()) this.savePosition(window);
        return;
      }
      const result = stepPetInertia(
        current,
        nextVelocity,
        this.displayForWindow(window),
        { width: PET_WINDOW_SIZE, height: PET_WINDOW_SIZE },
        { friction: 0.82, bounce },
      );
      current = result.position;
      nextVelocity = result.velocity;
      window.setPosition(result.position.x, result.position.y);
      steps += 1;
      if (result.done) {
        this.motionTimer = undefined;
        this.savePosition(window);
        return;
      }
      this.motionTimer = setTimeout(tick, 16);
    };
    this.motionTimer = setTimeout(tick, 16);
  }
}
