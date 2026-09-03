import { createHash } from 'node:crypto';
import type { DatabaseConnection } from '../database';
import type { Migration } from '../migration';

type Row = { name?: unknown };

const CHECKSUM_SOURCE = '006-knowledge-bases:knowledge-base-container-v1';

export const knowledgeBasesMigration: Migration = {
  version: 6,
  name: 'knowledge-bases',
  checksum: createHash('sha256').update(CHECKSUM_SOURCE).digest('hex'),
  up(db: DatabaseConnection): void {
    const now = new Date(0).toISOString();
    db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_bases (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, color TEXT,
        position INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_bases_position ON knowledge_bases(archived, position, id);
    `);
    db.prepare('INSERT OR IGNORE INTO knowledge_bases (id, name, position, archived, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)')
      .run('default', '默认知识库', 0, now, now);

    const columns = db.prepare('PRAGMA table_info(notes)').all() as Row[];
    if (!columns.some((column) => column.name === 'knowledge_base_id')) {
      db.exec("ALTER TABLE notes ADD COLUMN knowledge_base_id TEXT NOT NULL DEFAULT 'default' REFERENCES knowledge_bases(id) ON DELETE RESTRICT");
    }
    db.prepare("UPDATE notes SET knowledge_base_id = 'default' WHERE knowledge_base_id IS NULL OR knowledge_base_id = ''").run();
    db.exec('CREATE INDEX IF NOT EXISTS idx_notes_knowledge_base_parent_position ON notes(knowledge_base_id, parent_id, archived, position, id)');
  },
};
