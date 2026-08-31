import { createHash } from 'node:crypto';
import { createCanonicalBusinessSchema } from '../schema';
import type { Migration } from '../migration';

const CHECKSUM_SOURCE = '001-baseline:canonical-business-schema-v1';

export const baselineMigration: Migration = {
  version: 1,
  name: 'baseline',
  checksum: createHash('sha256').update(CHECKSUM_SOURCE).digest('hex'),
  up: createCanonicalBusinessSchema,
};
