export const SIDEBAR_WIDTH_STORAGE_KEY = 'yuheng-sidebar-width';
export const DEFAULT_SIDEBAR_WIDTH = 252;
export const MIN_SIDEBAR_WIDTH = 220;
export const MAX_SIDEBAR_WIDTH = 420;

export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SIDEBAR_WIDTH;
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, Math.round(value)));
}

export function loadSidebarWidth(storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): number {
  if (!storage) return DEFAULT_SIDEBAR_WIDTH;
  return clampSidebarWidth(Number(storage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)));
}
