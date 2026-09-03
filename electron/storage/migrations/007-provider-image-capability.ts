import { createHash } from 'node:crypto';
import type { DatabaseConnection } from '../database';
import type { Migration } from '../migration';

const CHECKSUM_SOURCE = '007-provider-image-capability:provider-supports-images-v1';

export const providerImageCapabilityMigration: Migration = {
  version: 7,
  name: 'provider-image-capability',
  checksum: createHash('sha256').update(CHECKSUM_SOURCE).digest('hex'),
  up(db: DatabaseConnection): void {
    const columns = db.prepare('PRAGMA table_info(provider_profiles)').all() as Array<{ name?: unknown }>;
    if (!columns.some((column) => column.name === 'supports_images')) {
      db.exec('ALTER TABLE provider_profiles ADD COLUMN supports_images INTEGER NOT NULL DEFAULT 0');
    }
  },
};
