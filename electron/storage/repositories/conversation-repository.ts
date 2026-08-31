import type { DatabaseConnection } from '../database';

export type ConversationRepositoryRow = { id: string; projectId: string; title: string; updatedAt: string; archived: boolean; pinned: boolean };

export class ConversationRepository {
  constructor(private readonly db: DatabaseConnection) {}

  list(includeArchived = false): ConversationRepositoryRow[] {
    const rows = this.db.prepare(`SELECT id, project_id AS projectId, title, updated_at AS updatedAt, archived, pinned FROM conversations ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY pinned DESC, updated_at DESC`).all() as Record<string, unknown>[];
    return rows.map((row) => ({ id: String(row.id), projectId: String(row.projectId), title: String(row.title), updatedAt: String(row.updatedAt), archived: Number(row.archived) === 1, pinned: Number(row.pinned) === 1 }));
  }

  get(id: string): ConversationRepositoryRow | null {
    return this.list(true).find((conversation) => conversation.id === id) ?? null;
  }
}
