import type { Migration } from '../migration';
import { baselineMigration } from './001-baseline';
import { normalizeLegacyV1Migration } from './002-normalize-legacy-v1';

export const migrations: readonly Migration[] = [baselineMigration, normalizeLegacyV1Migration];
export const CURRENT_STORAGE_SCHEMA_VERSION = migrations.length;
