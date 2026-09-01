import { app, Menu, nativeImage, Tray } from 'electron';
import path from 'node:path';
import { trayReminderTitle } from '../tray-state';

export type TrayLifecycleOptions = {
  enabled(): boolean;
  openMainWindow(): void;
  quitApplication(): void;
};

export class TrayLifecycle {
  private tray: Tray | undefined;
  private unreadReminderCount = 0;

  constructor(private readonly options: TrayLifecycleOptions) {}

  create(): void {
    if (process.platform !== 'darwin' || this.tray || !this.options.enabled()) return;
    const sourceIcon = nativeImage.createFromPath(path.join(app.getAppPath(), 'assets', 'yuheng-tray.png'));
    if (sourceIcon.isEmpty()) return;
    // Status items are 18pt on macOS; normalize the source asset so it does not render oversized.
    const icon = sourceIcon.resize({ width: 18, height: 18, quality: 'best' });
    icon.setTemplateImage(true);
    this.tray = new Tray(icon);
    this.tray.setToolTip('玉衡');
    this.tray.on('click', () => this.open());
    this.refreshMenu();
  }

  reminderAdded(): void {
    this.unreadReminderCount += 1;
    this.refreshMenu();
  }

  clearReminders(): void {
    if (this.unreadReminderCount === 0) return;
    this.unreadReminderCount = 0;
    this.refreshMenu();
  }

  dispose(): void {
    const tray = this.tray;
    this.tray = undefined;
    this.unreadReminderCount = 0;
    tray?.destroy();
  }

  private open(): void {
    this.clearReminders();
    this.options.openMainWindow();
  }

  private refreshMenu(): void {
    if (!this.tray) return;
    this.tray.setTitle(trayReminderTitle(this.unreadReminderCount));
    this.tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: this.unreadReminderCount > 0
          ? `待处理提醒（${trayReminderTitle(this.unreadReminderCount)}）`
          : '暂无待处理提醒',
        enabled: false,
      },
      { type: 'separator' },
      { label: '打开玉衡', click: () => this.open() },
      { label: '退出玉衡', click: () => this.options.quitApplication() },
    ]));
  }
}
