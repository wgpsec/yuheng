export type ToolPermissionMode = 'cautious' | 'smart' | 'full_session';
// Permission choices are scoped to a conversation and stored in app_settings.
// Full access still requires an explicit confirmation in the renderer before it is saved.
export type PersistentToolPermissionMode = ToolPermissionMode;

export const DEFAULT_TOOL_PERMISSION_MODE: PersistentToolPermissionMode = 'smart';

export function isToolPermissionMode(value: unknown): value is ToolPermissionMode {
  return value === 'cautious' || value === 'smart' || value === 'full_session';
}

export function isPersistentToolPermissionMode(value: unknown): value is PersistentToolPermissionMode {
  return isToolPermissionMode(value);
}
