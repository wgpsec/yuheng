import type { DatabaseOwner } from './database';
import { normalizeLegacyV1 } from './migrations/002-normalize-legacy-v1';
import { createCanonicalBusinessSchema, validateCanonicalBusinessSchema } from './schema';

// Compatibility path for tests and non-production callers that still construct
// AppStore from a data directory. Production opens and verifies its owner via
// prepareDatabase before the store is created.
export function prepareStandaloneDatabase(owner: DatabaseOwner): void {
  const hasBusinessTables = Boolean(owner.database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get());
  let canonical = false;
  if (hasBusinessTables) {
    try { canonical = validateCanonicalBusinessSchema(owner.database).ok; } catch { canonical = false; }
  }
  if (!hasBusinessTables) createCanonicalBusinessSchema(owner.database);
  else if (!canonical) normalizeLegacyV1(owner.database);
  owner.database.exec('PRAGMA user_version = 1');
}
