import { createHash } from 'node:crypto';
import type { DatabaseConnection } from '../database';
import type { Migration } from '../migration';

const CHECKSUM_SOURCE = '004-default-project-label:rename-personal-project-v1';

export const defaultProjectLabelMigration: Migration = {
  version: 4,
  name: 'default-project-label',
  checksum: createHash('sha256').update(CHECKSUM_SOURCE).digest('hex'),
  up(db: DatabaseConnection): void {
    const columns = db.prepare('PRAGMA table_info(conversations)').all() as Array<{ name?: unknown }>;
    if (!columns.some((column) => column.name === 'workspace_path')) db.exec('ALTER TABLE conversations ADD COLUMN workspace_path TEXT');
    db.prepare("UPDATE conversation_projects SET name = '默认' WHERE id = 'personal' AND name <> '默认'").run();
  },
};
