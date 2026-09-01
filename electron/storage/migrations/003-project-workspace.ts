import { createHash } from 'node:crypto';
import type { DatabaseConnection } from '../database';
import type { Migration } from '../migration';

const CHECKSUM_SOURCE = '003-project-workspace:conversation-project-workspace-path-v1';

export const projectWorkspaceMigration: Migration = {
  version: 3,
  name: 'project-workspace',
  checksum: createHash('sha256').update(CHECKSUM_SOURCE).digest('hex'),
  up(db): void {
    const columns = db.prepare('PRAGMA table_info(conversation_projects)').all() as Array<{ name?: unknown }>;
    if (!columns.some((column) => column.name === 'workspace_path')) db.exec('ALTER TABLE conversation_projects ADD COLUMN workspace_path TEXT');
  },
};
