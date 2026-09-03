import type { Migration } from '../migration';
import { baselineMigration } from './001-baseline';
import { normalizeLegacyV1Migration } from './002-normalize-legacy-v1';
import { projectWorkspaceMigration } from './003-project-workspace';
import { defaultProjectLabelMigration } from './004-default-project-label';
import { conversationWorkspaceMigration } from './005-conversation-workspace';
import { knowledgeBasesMigration } from './006-knowledge-bases';
import { providerImageCapabilityMigration } from './007-provider-image-capability';

export const migrations: readonly Migration[] = [baselineMigration, normalizeLegacyV1Migration, projectWorkspaceMigration, defaultProjectLabelMigration, conversationWorkspaceMigration, knowledgeBasesMigration, providerImageCapabilityMigration];
export const CURRENT_STORAGE_SCHEMA_VERSION = migrations.length;
