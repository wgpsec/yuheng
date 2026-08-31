import { DatabaseSync } from 'node:sqlite';

export type DatabaseConnection = DatabaseSync;

export type DatabaseOpenOptions = {
  readOnly?: boolean;
  busyTimeoutMs?: number;
};

export class DatabaseOwner {
  readonly databasePath: string;
  readonly database: DatabaseConnection;
  private closed = false;

  private constructor(databasePath: string, options: DatabaseOpenOptions) {
    this.databasePath = databasePath;
    this.database = new DatabaseSync(databasePath, {
      readOnly: options.readOnly ?? false,
      timeout: options.busyTimeoutMs ?? 5_000,
    });
    this.database.exec('PRAGMA foreign_keys = ON;');
    if (!options.readOnly) this.database.exec('PRAGMA journal_mode = WAL;');
  }

  static open(databasePath: string, options: DatabaseOpenOptions = {}): DatabaseOwner {
    return new DatabaseOwner(databasePath, options);
  }

  transaction<T>(operation: (database: DatabaseConnection) => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation(this.database);
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.database.exec('ROLLBACK'); } catch { /* Preserve the original failure. */ }
      throw error;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }
}
