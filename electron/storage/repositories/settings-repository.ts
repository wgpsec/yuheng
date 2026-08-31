import type { DatabaseConnection } from '../database';

type Row = Record<string, unknown>;

export class SettingsRepository {
  constructor(private readonly db: DatabaseConnection) {}

  get<T>(key: string, fallback: T, parse: (value: unknown) => T = ((value) => value as T)): T {
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as Row | undefined;
    if (!row) return fallback;
    try { return parse(JSON.parse(String(row.value))); }
    catch { return fallback; }
  }

  set<T>(key: string, value: T, now = new Date().toISOString()): T {
    this.db.prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at')
      .run(key, JSON.stringify(value), now);
    return value;
  }

  transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* Preserve the original error. */ }
      throw error;
    }
  }
}
