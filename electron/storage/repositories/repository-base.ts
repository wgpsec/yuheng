import type { DatabaseConnection, DatabaseOwner } from '../database';

export abstract class RepositoryBase {
  protected readonly db: DatabaseConnection;

  constructor(protected readonly owner: DatabaseOwner) {
    this.db = owner.database;
  }

  protected transaction<T>(operation: () => T): T {
    return this.owner.transaction(() => operation());
  }
}
