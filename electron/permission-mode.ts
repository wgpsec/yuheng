export type ToolPermissionMode = 'cautious' | 'smart' | 'full_session';
export type PersistentToolPermissionMode = Exclude<ToolPermissionMode, 'full_session'>;

export const DEFAULT_TOOL_PERMISSION_MODE: PersistentToolPermissionMode = 'smart';

export function isToolPermissionMode(value: unknown): value is ToolPermissionMode {
  return value === 'cautious' || value === 'smart' || value === 'full_session';
}

export function isPersistentToolPermissionMode(value: unknown): value is PersistentToolPermissionMode {
  return value === 'cautious' || value === 'smart';
}
