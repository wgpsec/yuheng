export function trayReminderTitle(unreadCount: number): string {
  if (!Number.isFinite(unreadCount) || unreadCount <= 0) return '';
  return unreadCount > 99 ? '99+' : String(Math.floor(unreadCount));
}
