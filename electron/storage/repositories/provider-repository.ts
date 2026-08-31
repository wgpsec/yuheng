import crypto from 'node:crypto';
import { RepositoryBase } from './repository-base';

export type ProviderRepositoryConfig = {
  id: string;
  protocol: 'openai' | 'anthropic';
  baseUrl: string;
  model: string;
  displayName: string;
  contextWindow: number;
  hasApiKey: boolean;
};

type Row = Record<string, unknown>;

export class ProviderRepository extends RepositoryBase {

  list(): ProviderRepositoryConfig[] {
    const rows = this.db.prepare("SELECT id, protocol, base_url AS baseUrl, model, display_name AS displayName, context_window AS contextWindow FROM provider_profiles ORDER BY CASE WHEN id = 'default' THEN 0 ELSE 1 END, updated_at ASC, id ASC").all() as Row[];
    return rows.map((row) => this.map(row));
  }

  get(id?: string): ProviderRepositoryConfig | null {
    const providerId = id ?? this.defaultId();
    if (!providerId) return null;
    const row = this.db.prepare('SELECT id, protocol, base_url AS baseUrl, model, display_name AS displayName, context_window AS contextWindow FROM provider_profiles WHERE id = ?').get(providerId) as Row | undefined;
    return row ? this.map(row) : null;
  }

  defaultId(): string | null {
    const row = this.db.prepare("SELECT id FROM provider_profiles ORDER BY CASE WHEN id = 'default' THEN 0 ELSE 1 END, updated_at ASC, id ASC LIMIT 1").get() as Row | undefined;
    return row ? String(row.id) : null;
  }

  save(config: Omit<ProviderRepositoryConfig, 'hasApiKey' | 'id'> & { id?: string }): ProviderRepositoryConfig {
    const existingCount = Number((this.db.prepare('SELECT COUNT(*) AS count FROM provider_profiles').get() as Row).count);
    const id = config.id?.trim() || (existingCount === 0 ? 'default' : crypto.randomUUID());
    const now = new Date().toISOString();
    this.transaction(() => {
      this.db.prepare(`INSERT INTO provider_profiles (id, protocol, base_url, model, display_name, context_window, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET protocol=excluded.protocol, base_url=excluded.base_url, model=excluded.model, display_name=excluded.display_name, context_window=excluded.context_window, updated_at=excluded.updated_at`)
        .run(id, config.protocol, config.baseUrl, config.model, config.displayName, config.contextWindow, now);
      if (existingCount === 0) this.db.prepare('UPDATE conversations SET provider_id = ? WHERE provider_id IS NULL').run(id);
    });
    return { ...config, id, hasApiKey: true };
  }

  delete(id: string): void {
    if (!this.get(id)) throw new Error('Provider not found.');
    const references = this.db.prepare('SELECT COUNT(*) AS count FROM conversations WHERE provider_id = ?').get(id) as Row;
    if (Number(references.count) > 0) throw new Error('Provider is still used by conversations.');
    this.db.prepare('DELETE FROM provider_profiles WHERE id = ?').run(id);
  }

  private map(row: Row): ProviderRepositoryConfig {
    return { id: String(row.id), protocol: row.protocol as ProviderRepositoryConfig['protocol'], baseUrl: String(row.baseUrl), model: String(row.model), displayName: String(row.displayName), contextWindow: Number(row.contextWindow), hasApiKey: false };
  }
}
