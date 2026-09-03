import { createHash } from 'node:crypto';
import type { DatabaseConnection } from '../database';
import type { Migration } from '../migration';

const CHECKSUM_SOURCE = '005-conversation-workspace:conversation-workspace-path-v1';

export const conversationWorkspaceMigration: Migration = {
  version: 5,
  name: 'conversation-workspace',
  checksum: createHash('sha256').update(CHECKSUM_SOURCE).digest('hex'),
  up(db: DatabaseConnection): void {
    const columns = db.prepare('PRAGMA table_info(conversations)').all() as Array<{ name?: unknown }>;
    if (!columns.some((column) => column.name === 'workspace_path')) db.exec('ALTER TABLE conversations ADD COLUMN workspace_path TEXT');
  },
};
