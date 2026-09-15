import { DEFAULT_TOOL_PERMISSION_MODE, isPersistentToolPermissionMode, type PersistentToolPermissionMode } from '../../permission-mode';
import type { BackupConfig, BrowserUseConfig, ComputerUseConfig, ConversationCapabilities, ConversationCapabilityOverride, DesktopPetConfig, DesktopPresenceConfig, ReasoningSelection } from '../../store';
import type { UserSkillRegistration } from '../../skills';
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
    // Older releases could persist both defaults as enabled. Keep Browser Use as
    // the stable precedence for that legacy state so opening an old database
    // never creates an invalid runtime capability combination.
    if (this.getBrowserUse().enabled) return { enabled: false };
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

  getConversationCapabilities(conversationId: string): ConversationCapabilities {
    this.requireConversation(conversationId);
    const capabilities = this.get(`conversation_capabilities:${conversationId}`, { browserUse: 'default', computerUse: 'default' } satisfies ConversationCapabilities, readConversationCapabilities);
    return capabilities.browserUse === 'enabled' && capabilities.computerUse === 'enabled'
      ? { ...capabilities, computerUse: 'disabled' }
      : capabilities;
  }

  saveConversationCapabilities(conversationId: string, capabilities: ConversationCapabilities): ConversationCapabilities {
    this.requireConversation(conversationId);
    let normalized = readConversationCapabilities(capabilities);
    if (normalized.browserUse === 'enabled' && normalized.computerUse === 'enabled') {
      throw new Error('Browser Use 与 Computer Use 不能同时开启。');
    }
    if (normalized.browserUse === 'enabled' && normalized.computerUse === 'default' && this.getComputerUse().enabled) {
      normalized = { ...normalized, computerUse: 'disabled' };
    }
    if (normalized.computerUse === 'enabled' && normalized.browserUse === 'default' && this.getBrowserUse().enabled) {
      normalized = { ...normalized, browserUse: 'disabled' };
    }
    return this.set(`conversation_capabilities:${conversationId}`, normalized);
  }

  getSkillRegistrations(): UserSkillRegistration[] {
    return this.get('skill_registrations', [], readSkillRegistrations);
  }

  saveSkillRegistrations(registrations: UserSkillRegistration[]): UserSkillRegistration[] {
    const normalized = readSkillRegistrations(registrations);
    return this.set('skill_registrations', normalized);
  }

  getConversationSkills(conversationId: string): string[] {
    this.requireConversation(conversationId);
    return this.get(`conversation_skills:${conversationId}`, [], readSkillIds);
  }

  saveConversationSkills(conversationId: string, skillIds: string[]): string[] {
    this.requireConversation(conversationId);
    const normalized = readSkillIds(skillIds);
    return this.set(`conversation_skills:${conversationId}`, normalized);
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
    if (!isPersistentToolPermissionMode(mode)) throw new Error('Unsupported tool permission mode.');
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

function readConversationCapabilities(value: unknown): ConversationCapabilities {
  const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const normalize = (candidate: unknown): ConversationCapabilityOverride => candidate === 'enabled' || candidate === 'disabled' ? candidate : 'default';
  return { browserUse: normalize(item.browserUse), computerUse: normalize(item.computerUse) };
}

function readSkillIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()))];
}

function readSkillRegistrations(value: unknown): UserSkillRegistration[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Record<string, unknown>;
    if (typeof raw.id !== 'string' || typeof raw.path !== 'string' || !raw.path.trim()) return [];
    return [{
      id: raw.id.trim(),
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : raw.id.trim(),
      description: typeof raw.description === 'string' ? raw.description.trim() : '',
      path: raw.path.trim(),
      enabled: raw.enabled === true,
    } satisfies UserSkillRegistration];
  });
}

function numberInRange(value: unknown, minimum: number, maximum: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : undefined;
}

function isReasoningSelection(value: unknown): value is ReasoningSelection {
  return value === 'default' || value === 'off' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' || value === 'max';
}
