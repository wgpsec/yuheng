import type { DatabaseConnection } from '../database';

export class BackupRepository {
  constructor(private readonly db: DatabaseConnection) {}

  snapshot<T>(read: (db: DatabaseConnection) => T): T {
    this.db.exec('BEGIN');
    try {
      const result = read(this.db);
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* Preserve the original error. */ }
      throw error;
    }
  }
}
