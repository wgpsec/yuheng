import { DEFAULT_TOOL_PERMISSION_MODE, isPersistentToolPermissionMode, type PersistentToolPermissionMode } from '../../permission-mode';
import type { BackupConfig, BrowserUseConfig, ComputerUseConfig, DesktopPetConfig, DesktopPresenceConfig, ReasoningSelection } from '../../store';
import { RepositoryBase } from './repository-base';

type Row = Record<string, unknown>;

export class SettingsRepository extends RepositoryBase {

  get<T>(key: string, fallback: T, parse: (value: unknown) => T = ((value) => value as T)): T {
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as Row | undefined;
    if (!row) return fallback;
    try { return parse(JSON.parse(String(row.value))); } catch { return fallback; }
  }

  set<T>(key: string, value: T, now = new Date().toISOString()): T {
    this.db.prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at')
      .run(key, JSON.stringify(value), now);
    return value;
  }

  getBrowserUse(): BrowserUseConfig {
    return this.get('browser_use', { enabled: false }, readEnabledConfig);
  }

  saveBrowserUse(config: BrowserUseConfig): BrowserUseConfig {
    const normalized = { enabled: config.enabled === true };
    this.transaction(() => {
      this.set('browser_use', normalized);
      if (normalized.enabled) this.set('computer_use', { enabled: false });
    });
    return normalized;
  }

  getComputerUse(): ComputerUseConfig {
    return this.get('computer_use', { enabled: false }, readEnabledConfig);
  }

  saveComputerUse(config: ComputerUseConfig): ComputerUseConfig {
    const normalized = { enabled: config.enabled === true };
    this.transaction(() => {
      this.set('computer_use', normalized);
      if (normalized.enabled) this.set('browser_use', { enabled: false });
    });
    return normalized;
  }

  getDesktopPet(): DesktopPetConfig {
    const value = this.get<Record<string, unknown> | null>('desktop_pet', null, (item) => item && typeof item === 'object' ? item as Record<string, unknown> : null);
    if (!value) return { enabled: false };
    const petId = typeof value.petId === 'string' && value.petId.trim() ? value.petId.trim() : undefined;
    const scale = numberInRange(value.scale, 0.8, 1.4);
    const opacity = numberInRange(value.opacity, 0.2, 1);
    const locked = typeof value.locked === 'boolean' ? value.locked : undefined;
    const alwaysOnTop = typeof value.alwaysOnTop === 'boolean' ? value.alwaysOnTop : undefined;
    const edgeSnap = typeof value.edgeSnap === 'boolean' ? value.edgeSnap : undefined;
    const inertia = typeof value.inertia === 'boolean' ? value.inertia : undefined;
    const boundaryBounce = typeof value.boundaryBounce === 'boolean' ? value.boundaryBounce : undefined;
    const feedbackMode = value.feedbackMode === 'important' || value.feedbackMode === 'all' || value.feedbackMode === 'hidden' ? value.feedbackMode : undefined;
    const completionFeedback = typeof value.completionFeedback === 'boolean' ? value.completionFeedback : undefined;
    const errorFeedback = typeof value.errorFeedback === 'boolean' ? value.errorFeedback : undefined;
    const approvalFeedback = typeof value.approvalFeedback === 'boolean' ? value.approvalFeedback : undefined;
    const soundEnabled = typeof value.soundEnabled === 'boolean' ? value.soundEnabled : undefined;
    const mutedUntil = typeof value.mutedUntil === 'number' && Number.isFinite(value.mutedUntil) && value.mutedUntil > 0 ? value.mutedUntil : undefined;
    return {
      enabled: value.enabled === true,
      ...(petId ? { petId } : {}), ...(scale !== undefined ? { scale } : {}), ...(locked !== undefined ? { locked } : {}),
      ...(opacity !== undefined ? { opacity } : {}), ...(alwaysOnTop !== undefined ? { alwaysOnTop } : {}), ...(edgeSnap !== undefined ? { edgeSnap } : {}),
      ...(inertia !== undefined ? { inertia } : {}), ...(boundaryBounce !== undefined ? { boundaryBounce } : {}), ...(feedbackMode ? { feedbackMode } : {}),
      ...(completionFeedback !== undefined ? { completionFeedback } : {}), ...(errorFeedback !== undefined ? { errorFeedback } : {}),
      ...(approvalFeedback !== undefined ? { approvalFeedback } : {}), ...(soundEnabled !== undefined ? { soundEnabled } : {}), ...(mutedUntil !== undefined ? { mutedUntil } : {}),
    };
  }

  saveDesktopPet(config: DesktopPetConfig): DesktopPetConfig {
    const petId = typeof config.petId === 'string' && config.petId.trim() ? config.petId.trim() : undefined;
    const scale = numberInRange(config.scale, 0.8, 1.4);
    const opacity = numberInRange(config.opacity, 0.2, 1);
    const locked = typeof config.locked === 'boolean' ? config.locked : undefined;
    const alwaysOnTop = typeof config.alwaysOnTop === 'boolean' ? config.alwaysOnTop : undefined;
    const edgeSnap = typeof config.edgeSnap === 'boolean' ? config.edgeSnap : undefined;
    const inertia = typeof config.inertia === 'boolean' ? config.inertia : undefined;
    const boundaryBounce = typeof config.boundaryBounce === 'boolean' ? config.boundaryBounce : undefined;
    const feedbackMode = config.feedbackMode === 'important' || config.feedbackMode === 'all' || config.feedbackMode === 'hidden' ? config.feedbackMode : undefined;
    const completionFeedback = typeof config.completionFeedback === 'boolean' ? config.completionFeedback : undefined;
    const errorFeedback = typeof config.errorFeedback === 'boolean' ? config.errorFeedback : undefined;
    const approvalFeedback = typeof config.approvalFeedback === 'boolean' ? config.approvalFeedback : undefined;
    const soundEnabled = typeof config.soundEnabled === 'boolean' ? config.soundEnabled : undefined;
    const mutedUntil = typeof config.mutedUntil === 'number' && Number.isFinite(config.mutedUntil) && config.mutedUntil > 0 ? config.mutedUntil : undefined;
    return this.set('desktop_pet', {
      enabled: config.enabled === true,
      ...(petId ? { petId } : {}), ...(scale !== undefined ? { scale } : {}), ...(locked !== undefined ? { locked } : {}), ...(opacity !== undefined ? { opacity } : {}),
      ...(alwaysOnTop !== undefined ? { alwaysOnTop } : {}), ...(edgeSnap !== undefined ? { edgeSnap } : {}), ...(inertia !== undefined ? { inertia } : {}), ...(boundaryBounce !== undefined ? { boundaryBounce } : {}),
      ...(feedbackMode ? { feedbackMode } : {}), ...(completionFeedback !== undefined ? { completionFeedback } : {}), ...(errorFeedback !== undefined ? { errorFeedback } : {}), ...(approvalFeedback !== undefined ? { approvalFeedback } : {}),
      ...(soundEnabled !== undefined ? { soundEnabled } : {}), ...(mutedUntil !== undefined ? { mutedUntil } : {}),
    } satisfies DesktopPetConfig);
  }

  getReasoning(conversationId: string): ReasoningSelection {
    const row = this.db.prepare('SELECT reasoning_level AS reasoningLevel FROM conversations WHERE id = ?').get(conversationId) as Row | undefined;
    if (!row) throw new Error('Conversation not found.');
    return isReasoningSelection(row.reasoningLevel) ? row.reasoningLevel : 'default';
  }

  saveReasoning(conversationId: string, selection: ReasoningSelection): ReasoningSelection {
    const normalized = isReasoningSelection(selection) ? selection : 'default';
    const result = this.db.prepare('UPDATE conversations SET reasoning_level = ? WHERE id = ?').run(normalized, conversationId);
    if (Number(result.changes) === 0) throw new Error('Conversation not found.');
    return normalized;
  }

  getToolPermission(conversationId: string): PersistentToolPermissionMode {
    this.requireConversation(conversationId);
    return this.get(`tool_permission:${conversationId}`, DEFAULT_TOOL_PERMISSION_MODE, (value) => isPersistentToolPermissionMode(value) ? value : DEFAULT_TOOL_PERMISSION_MODE);
  }

  saveToolPermission(conversationId: string, mode: PersistentToolPermissionMode): PersistentToolPermissionMode {
    this.requireConversation(conversationId);
    if (!isPersistentToolPermissionMode(mode)) throw new Error('Only persistent permission modes can be stored.');
    return this.set(`tool_permission:${conversationId}`, mode);
  }

  getBackup(defaultDirectory: string): BackupConfig {
    const fallback: BackupConfig = { enabled: false, directory: defaultDirectory, retention: 7, lastRunAt: null, lastError: null };
    return this.get('backup_config', fallback, (value) => {
      const item = value && typeof value === 'object' ? value as Partial<BackupConfig> : {};
      return { enabled: item.enabled === true, directory: typeof item.directory === 'string' && item.directory ? item.directory : defaultDirectory, retention: Math.min(30, Math.max(1, Number(item.retention) || 7)), lastRunAt: typeof item.lastRunAt === 'string' ? item.lastRunAt : null, lastError: typeof item.lastError === 'string' ? item.lastError : null };
    });
  }

  saveBackup(config: Pick<BackupConfig, 'enabled' | 'directory' | 'retention'> & Partial<Pick<BackupConfig, 'lastRunAt' | 'lastError'>>): BackupConfig {
    const value: BackupConfig = { enabled: config.enabled === true, directory: config.directory.trim(), retention: Math.min(30, Math.max(1, Math.round(config.retention))), lastRunAt: config.lastRunAt ?? null, lastError: config.lastError ?? null };
    return this.set('backup_config', value);
  }

  getDesktopPresence(): DesktopPresenceConfig {
    return this.get('desktop_presence', { notificationsEnabled: true, menuBarEnabled: true }, (value) => {
      const item = value && typeof value === 'object' ? value as Partial<DesktopPresenceConfig> : {};
      return { notificationsEnabled: item.notificationsEnabled !== false, menuBarEnabled: item.menuBarEnabled !== false };
    });
  }

  saveDesktopPresence(config: Partial<DesktopPresenceConfig>): DesktopPresenceConfig {
    const current = this.getDesktopPresence();
    return this.set('desktop_presence', { notificationsEnabled: config.notificationsEnabled ?? current.notificationsEnabled, menuBarEnabled: config.menuBarEnabled ?? current.menuBarEnabled });
  }

  private requireConversation(id: string): void {
    if (!this.db.prepare('SELECT 1 FROM conversations WHERE id = ?').get(id)) throw new Error('Conversation not found.');
  }
}

function readEnabledConfig(value: unknown): { enabled: boolean } {
  return { enabled: Boolean(value && typeof value === 'object' && (value as Record<string, unknown>).enabled === true) };
}

function numberInRange(value: unknown, minimum: number, maximum: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : undefined;
}

function isReasoningSelection(value: unknown): value is ReasoningSelection {
  return value === 'default' || value === 'off' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' || value === 'max';
}
