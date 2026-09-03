import crypto from 'node:crypto';
import { RepositoryBase } from './repository-base';

export type ProviderRepositoryConfig = {
  id: string;
  protocol: 'openai' | 'anthropic';
  baseUrl: string;
  model: string;
  displayName: string;
  contextWindow: number;
  supportsImages: boolean;
  hasApiKey: boolean;
};

type Row = Record<string, unknown>;
const DEFAULT_PROVIDER_SETTING = 'default_provider_id';

export class ProviderRepository extends RepositoryBase {

  list(): ProviderRepositoryConfig[] {
    const rows = this.db.prepare("SELECT id, protocol, base_url AS baseUrl, model, display_name AS displayName, context_window AS contextWindow, supports_images AS supportsImages FROM provider_profiles ORDER BY CASE WHEN id = 'default' THEN 0 ELSE 1 END, updated_at ASC, id ASC").all() as Row[];
    return rows.map((row) => this.map(row));
  }

  get(id?: string): ProviderRepositoryConfig | null {
    const providerId = id ?? this.defaultId();
    if (!providerId) return null;
    const row = this.db.prepare('SELECT id, protocol, base_url AS baseUrl, model, display_name AS displayName, context_window AS contextWindow, supports_images AS supportsImages FROM provider_profiles WHERE id = ?').get(providerId) as Row | undefined;
    return row ? this.map(row) : null;
  }

  defaultId(): string | null {
    const configured = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(DEFAULT_PROVIDER_SETTING) as Row | undefined;
    if (configured) {
      try {
        const id = JSON.parse(String(configured.value));
        if (typeof id === 'string' && id.trim() && this.providerExists(id.trim())) return id.trim();
      } catch {
        // Ignore damaged settings and retain the legacy deterministic fallback.
      }
    }
    const row = this.db.prepare("SELECT id FROM provider_profiles ORDER BY CASE WHEN id = 'default' THEN 0 ELSE 1 END, updated_at ASC, id ASC LIMIT 1").get() as Row | undefined;
    return row ? String(row.id) : null;
  }

  setDefaultId(id: string): string {
    const normalized = id.trim();
    if (!normalized || !this.providerExists(normalized)) throw new Error('Provider not found.');
    const now = new Date().toISOString();
    this.db.prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at')
      .run(DEFAULT_PROVIDER_SETTING, JSON.stringify(normalized), now);
    return normalized;
  }

  save(config: Omit<ProviderRepositoryConfig, 'hasApiKey' | 'id' | 'supportsImages'> & { id?: string; supportsImages?: boolean }): ProviderRepositoryConfig {
    const existingCount = Number((this.db.prepare('SELECT COUNT(*) AS count FROM provider_profiles').get() as Row).count);
    const id = config.id?.trim() || (existingCount === 0 ? 'default' : crypto.randomUUID());
    const now = new Date().toISOString();
    this.transaction(() => {
      this.db.prepare(`INSERT INTO provider_profiles (id, protocol, base_url, model, display_name, context_window, supports_images, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET protocol=excluded.protocol, base_url=excluded.base_url, model=excluded.model, display_name=excluded.display_name, context_window=excluded.context_window, supports_images=excluded.supports_images, updated_at=excluded.updated_at`)
        .run(id, config.protocol, config.baseUrl, config.model, config.displayName, config.contextWindow, config.supportsImages === true ? 1 : 0, now);
      if (existingCount === 0) this.db.prepare('UPDATE conversations SET provider_id = ? WHERE provider_id IS NULL').run(id);
    });
    return { ...config, id, supportsImages: config.supportsImages === true, hasApiKey: true };
  }

  delete(id: string): void {
    if (!this.get(id)) throw new Error('Provider not found.');
    if (this.defaultId() === id) throw new Error('请先选择其他默认 Provider，再删除当前默认项。');
    const references = this.db.prepare('SELECT COUNT(*) AS count FROM conversations WHERE provider_id = ?').get(id) as Row;
    if (Number(references.count) > 0) throw new Error('Provider is still used by conversations.');
    this.db.prepare('DELETE FROM provider_profiles WHERE id = ?').run(id);
  }

  private providerExists(id: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM provider_profiles WHERE id = ?').get(id));
  }

  private map(row: Row): ProviderRepositoryConfig {
    return { id: String(row.id), protocol: row.protocol as ProviderRepositoryConfig['protocol'], baseUrl: String(row.baseUrl), model: String(row.model), displayName: String(row.displayName), contextWindow: Number(row.contextWindow), supportsImages: Number(row.supportsImages) === 1, hasApiKey: false };
  }
}
