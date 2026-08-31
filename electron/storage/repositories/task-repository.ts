import type { DatabaseConnection } from '../database';

export type TaskRepositoryRow = { id: string; boardId: string; title: string; status: string; position: number; updatedAt: string };

export class TaskRepository {
  constructor(private readonly db: DatabaseConnection) {}

  list(boardId = 'default'): TaskRepositoryRow[] {
    const rows = this.db.prepare('SELECT id, board_id AS boardId, title, status, position, updated_at AS updatedAt FROM tasks WHERE board_id = ? ORDER BY status, position, updated_at DESC').all(boardId) as Record<string, unknown>[];
    return rows.map((row) => ({ id: String(row.id), boardId: String(row.boardId), title: String(row.title), status: String(row.status), position: Number(row.position), updatedAt: String(row.updatedAt) }));
  }
}
