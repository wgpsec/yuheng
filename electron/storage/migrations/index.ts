import type { Migration } from '../migration';
import { baselineMigration } from './001-baseline';
import { normalizeLegacyV1Migration } from './002-normalize-legacy-v1';
import { projectWorkspaceMigration } from './003-project-workspace';

export const migrations: readonly Migration[] = [baselineMigration, normalizeLegacyV1Migration, projectWorkspaceMigration];
export const CURRENT_STORAGE_SCHEMA_VERSION = migrations.length;
