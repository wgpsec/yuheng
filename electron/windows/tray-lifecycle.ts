import { Menu, nativeImage, Tray } from 'electron';
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
    const icon = nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><path fill="none" stroke="black" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M9 2.2 15.5 6v6L9 15.8 2.5 12V6L9 2.2Z"/><path fill="none" stroke="black" stroke-width="1.4" stroke-linecap="round" d="m5.4 8.9 2.2 2.2 4.8-4.8"/></svg>')}`);
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
