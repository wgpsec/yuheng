import type { DatabaseConnection } from '../database';

export class SearchRepository {
  constructor(private readonly db: DatabaseConnection) {}

  hasFullTextIndex(): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'search_index'").get());
  }
}
