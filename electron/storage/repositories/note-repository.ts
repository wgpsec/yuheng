import type { DatabaseConnection } from '../database';

export type NoteRepositoryRow = { id: string; parentId: string | null; title: string; position: number; archived: boolean; updatedAt: string };

export class NoteRepository {
  constructor(private readonly db: DatabaseConnection) {}

  list(includeArchived = false): NoteRepositoryRow[] {
    const rows = this.db.prepare(`SELECT id, parent_id AS parentId, title, position, archived, updated_at AS updatedAt FROM notes ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY parent_id, position, id`).all() as Record<string, unknown>[];
    return rows.map((row) => ({ id: String(row.id), parentId: row.parentId == null ? null : String(row.parentId), title: String(row.title), position: Number(row.position), archived: Number(row.archived) === 1, updatedAt: String(row.updatedAt) }));
  }
}
