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
  private transactionDepth = 0;

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
    const depth = this.transactionDepth;
    const savepoint = `yuheng_transaction_${depth}`;
    this.database.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
    this.transactionDepth += 1;
    try {
      const result = operation(this.database);
      this.database.exec(depth === 0 ? 'COMMIT' : `RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      try {
        if (depth === 0) this.database.exec('ROLLBACK');
        else this.database.exec(`ROLLBACK TO SAVEPOINT ${savepoint}; RELEASE SAVEPOINT ${savepoint}`);
      } catch { /* Preserve the original failure. */ }
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }
}
