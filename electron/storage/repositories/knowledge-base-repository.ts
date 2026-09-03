import crypto from 'node:crypto';
import type { CreateKnowledgeBaseInput, KnowledgeBase, UpdateKnowledgeBaseInput } from '../../store';
import { RepositoryBase } from './repository-base';

type Row = Record<string, unknown>;

const DEFAULT_KNOWLEDGE_BASE_ID = 'default';

export class KnowledgeBaseRepository extends RepositoryBase {
  getActiveId(): string | null {
    return this.settingsValue('active_knowledge_base_id');
  }

  setActiveId(id: string): string {
    const base = this.get(id);
    if (!base || base.archived) throw new Error('Knowledge base is not available.');
    this.db.prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at')
      .run('active_knowledge_base_id', JSON.stringify(id), new Date().toISOString());
    return id;
  }
  list(includeArchived = false): KnowledgeBase[] {
    const rows = this.db.prepare(`SELECT id, name, icon, color, position, archived,
      created_at AS createdAt, updated_at AS updatedAt FROM knowledge_bases
      ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY position ASC, id ASC`).all() as Row[];
    return rows.map((row) => this.map(row));
  }

  get(id: string): KnowledgeBase | null {
    const row = this.db.prepare(`SELECT id, name, icon, color, position, archived,
      created_at AS createdAt, updated_at AS updatedAt FROM knowledge_bases WHERE id = ?`).get(id) as Row | undefined;
    return row ? this.map(row) : null;
  }

  getDefault(): KnowledgeBase {
    const configured = this.get(DEFAULT_KNOWLEDGE_BASE_ID);
    if (configured) return configured;
    const fallback = this.db.prepare('SELECT id, name, icon, color, position, archived, created_at AS createdAt, updated_at AS updatedAt FROM knowledge_bases ORDER BY archived ASC, position ASC, id ASC LIMIT 1').get() as Row | undefined;
    if (!fallback) throw new Error('At least one knowledge base is required.');
    return this.map(fallback);
  }

  create(input: CreateKnowledgeBaseInput = {}): KnowledgeBase {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) throw new Error('Knowledge base name is required.');
    const icon = typeof input.icon === 'string' ? input.icon.trim().slice(0, 32) || null : null;
    const color = typeof input.color === 'string' ? input.color.trim().slice(0, 32) || null : null;
    const id = crypto.randomUUID();
    const position = Number((this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM knowledge_bases').get() as Row).position);
    const now = new Date().toISOString();
    this.db.prepare('INSERT INTO knowledge_bases (id, name, icon, color, position, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)')
      .run(id, name, icon, color, position, now, now);
    return this.get(id)!;
  }

  update(id: string, patch: UpdateKnowledgeBaseInput): KnowledgeBase {
    const current = this.get(id);
    if (!current) throw new Error('Knowledge base not found.');
    const name = patch.name === undefined ? current.name : patch.name.trim();
    if (!name) throw new Error('Knowledge base name is required.');
    const icon = patch.icon === undefined ? current.icon : patch.icon == null ? null : patch.icon.trim().slice(0, 32) || null;
    const color = patch.color === undefined ? current.color : patch.color == null ? null : patch.color.trim().slice(0, 32) || null;
    const archived = patch.archived === undefined ? current.archived : patch.archived === true;
    if (id === DEFAULT_KNOWLEDGE_BASE_ID && archived) throw new Error('The default knowledge base cannot be archived.');
    const updatedAt = new Date().toISOString();
    this.db.prepare('UPDATE knowledge_bases SET name = ?, icon = ?, color = ?, archived = ?, updated_at = ? WHERE id = ?')
      .run(name, icon, color, archived ? 1 : 0, updatedAt, id);
    return this.get(id)!;
  }

  reorder(id: string, targetId: string): KnowledgeBase[] {
    const items = this.list(true);
    const sourceIndex = items.findIndex((item) => item.id === id);
    const targetIndex = items.findIndex((item) => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) throw new Error('Knowledge base not found.');
    if (sourceIndex === targetIndex) return items;
    const [moved] = items.splice(sourceIndex, 1);
    items.splice(targetIndex, 0, moved);
    this.transaction(() => {
      const update = this.db.prepare('UPDATE knowledge_bases SET position = ? WHERE id = ?');
      items.forEach((item, position) => update.run(position, item.id));
    });
    return this.list(true);
  }

  delete(id: string): void {
    if (id === DEFAULT_KNOWLEDGE_BASE_ID) throw new Error('The default knowledge base cannot be deleted.');
    const current = this.get(id);
    if (!current) throw new Error('Knowledge base not found.');
    this.transaction(() => {
      // Remove pages first; the schema intentionally keeps a RESTRICT FK for direct SQL deletes.
      this.db.prepare('DELETE FROM notes WHERE knowledge_base_id = ?').run(id);
      this.db.prepare('DELETE FROM knowledge_bases WHERE id = ?').run(id);
      this.db.prepare('UPDATE knowledge_bases SET position = position - 1 WHERE position > ?').run(current.position);
      if (this.getActiveId() === id) {
        const fallback = this.db.prepare('SELECT id FROM knowledge_bases WHERE archived = 0 ORDER BY position ASC, id ASC LIMIT 1').get() as Row | undefined;
        if (fallback?.id) {
          const updatedAt = new Date().toISOString();
          this.db.prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at')
            .run('active_knowledge_base_id', JSON.stringify(String(fallback.id)), updatedAt);
        } else {
          this.db.prepare('DELETE FROM app_settings WHERE key = ?').run('active_knowledge_base_id');
        }
      }
    });
  }

  private map(row: Row): KnowledgeBase {
    return {
      id: String(row.id), name: String(row.name), icon: row.icon == null ? null : String(row.icon),
      color: row.color == null ? null : String(row.color), position: Number(row.position ?? 0),
      archived: Number(row.archived) === 1, createdAt: String(row.createdAt), updatedAt: String(row.updatedAt),
    };
  }

  private settingsValue(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as Row | undefined;
    if (!row) return null;
    try { const value = JSON.parse(String(row.value)); return typeof value === 'string' && value ? value : null; } catch { return null; }
  }
}
