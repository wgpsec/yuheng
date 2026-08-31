import { createHash } from 'node:crypto';
import type { DatabaseConnection } from '../database';
import type { Migration } from '../migration';
import { createCanonicalBusinessSchema } from '../schema';

type Row = Record<string, unknown>;

const CHECKSUM_SOURCE = '002-normalize-legacy-v1:provider-conversation-run-artifact-task-note-v2';

export const normalizeLegacyV1Migration: Migration = {
  version: 2,
  name: 'normalize-legacy-v1',
  checksum: createHash('sha256').update(CHECKSUM_SOURCE).digest('hex'),
  up(db): void {
    normalizeLegacyV1(db);
  },
};

export function normalizeLegacyV1(db: DatabaseConnection): void {
  dropSearchTriggers(db);
  createFoundations(db);
  addLegacyColumns(db);
  createCanonicalBusinessSchema(db);
  rebuildProviderProfiles(db);
  rebuildConversations(db);
  rebuildRunArtifacts(db);
  rebuildTaskTypes(db);
  rebuildTasks(db);
  createCanonicalBusinessSchema(db);

  const defaultProvider = db.prepare('SELECT id FROM provider_profiles ORDER BY updated_at DESC LIMIT 1').get() as Row | undefined;
  if (defaultProvider) db.prepare('UPDATE conversations SET provider_id = ? WHERE provider_id IS NULL').run(String(defaultProvider.id));
  migrateLegacyReasoningSelection(db);
}

function createFoundations(db: DatabaseConnection): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_boards (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL
    );
  `);
  const epoch = new Date(0).toISOString();
  db.prepare('INSERT OR IGNORE INTO conversation_projects (id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('personal', '个人事务', 0, epoch, epoch);
  db.prepare('INSERT OR IGNORE INTO task_boards (id, name, position) VALUES (?, ?, ?)').run('default', '默认看板', 0);
}

function addLegacyColumns(db: DatabaseConnection): void {
  addColumn(db, 'provider_profiles', 'context_window', 'INTEGER NOT NULL DEFAULT 200000');
  addColumn(db, 'conversations', 'project_id', "TEXT REFERENCES conversation_projects(id)");
  addColumn(db, 'conversations', 'description', "TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'conversations', 'archived', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'conversations', 'pinned', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'conversations', 'reasoning_level', "TEXT NOT NULL DEFAULT 'default'");
  addColumn(db, 'conversations', 'provider_id', 'TEXT');
  addColumn(db, 'conversations', 'profile_id', "TEXT NOT NULL DEFAULT 'assistant'");
  if (tableExists(db, 'conversations')) db.prepare('UPDATE conversations SET project_id = ? WHERE project_id IS NULL').run('personal');

  addColumn(db, 'runs', 'input_message_id', 'TEXT REFERENCES messages(id) ON DELETE SET NULL');
  for (const column of ['input_tokens', 'output_tokens', 'total_tokens', 'context_tokens', 'context_window']) addColumn(db, 'runs', column, 'INTEGER');
  addColumn(db, 'runs', 'context_percent', 'REAL');

  if (tableExists(db, 'task_types')) addColumn(db, 'task_types', 'board_id', "TEXT NOT NULL DEFAULT 'default'");
  if (tableExists(db, 'tasks')) {
    addColumn(db, 'tasks', 'board_id', "TEXT NOT NULL DEFAULT 'default'");
    addColumn(db, 'tasks', 'description', "TEXT NOT NULL DEFAULT ''");
    addColumn(db, 'tasks', 'position', 'INTEGER NOT NULL DEFAULT 0');
    addColumn(db, 'tasks', 'remind_at', 'TEXT');
    addColumn(db, 'tasks', 'reminder_fired_at', 'TEXT');
  }

  if (tableExists(db, 'notes')) {
    addColumn(db, 'notes', 'icon', 'TEXT');
    addColumn(db, 'notes', 'cover', 'TEXT');
    addColumn(db, 'notes', 'properties_json', "TEXT NOT NULL DEFAULT '{}'");
    addColumn(db, 'notes', 'favorite', 'INTEGER NOT NULL DEFAULT 0');
    addColumn(db, 'notes', 'last_opened_at', 'TEXT');
  }
  if (tableExists(db, 'note_versions')) {
    addColumn(db, 'note_versions', 'icon', 'TEXT');
    addColumn(db, 'note_versions', 'cover', 'TEXT');
    addColumn(db, 'note_versions', 'properties_json', "TEXT NOT NULL DEFAULT '{}'");
  }
}

function rebuildProviderProfiles(db: DatabaseConnection): void {
  db.exec(`
    DROP TABLE IF EXISTS provider_profiles_v2;
    CREATE TABLE provider_profiles_v2 (
      id TEXT PRIMARY KEY,
      protocol TEXT NOT NULL CHECK (protocol IN ('openai', 'anthropic')),
      base_url TEXT NOT NULL, model TEXT NOT NULL, display_name TEXT NOT NULL,
      context_window INTEGER NOT NULL DEFAULT 200000, updated_at TEXT NOT NULL
    );
    INSERT INTO provider_profiles_v2 (id, protocol, base_url, model, display_name, context_window, updated_at)
      SELECT CASE WHEN typeof(id) = 'integer' THEN 'default' ELSE CAST(id AS TEXT) END,
        protocol, base_url, model, display_name, context_window, updated_at
      FROM provider_profiles;
    DROP TABLE provider_profiles;
    ALTER TABLE provider_profiles_v2 RENAME TO provider_profiles;
  `);
}

function rebuildConversations(db: DatabaseConnection): void {
  db.exec(`
    DROP TABLE IF EXISTS conversations_v2;
    CREATE TABLE conversations_v2 (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL DEFAULT 'personal' REFERENCES conversation_projects(id),
      title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      archived INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0,
      reasoning_level TEXT NOT NULL DEFAULT 'default', provider_id TEXT,
      profile_id TEXT NOT NULL DEFAULT 'assistant', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO conversations_v2
      (id, project_id, title, description, archived, pinned, reasoning_level, provider_id, profile_id, created_at, updated_at)
      SELECT id, COALESCE(project_id, 'personal'), title, description, archived, pinned,
        reasoning_level, provider_id, profile_id, created_at, updated_at FROM conversations;
    DROP TABLE conversations;
    ALTER TABLE conversations_v2 RENAME TO conversations;
  `);
}

function rebuildRunArtifacts(db: DatabaseConnection): void {
  db.exec(`
    DROP TABLE IF EXISTS run_artifacts_v2;
    CREATE TABLE run_artifacts_v2 (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      tool_call_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('browser_screenshot', 'computer_screenshot')),
      mime_type TEXT NOT NULL, size INTEGER NOT NULL, url TEXT NOT NULL, created_at TEXT NOT NULL
    );
    INSERT INTO run_artifacts_v2 SELECT id, run_id, tool_call_id, kind, mime_type, size, url, created_at FROM run_artifacts;
    DROP TABLE run_artifacts;
    ALTER TABLE run_artifacts_v2 RENAME TO run_artifacts;
  `);
}

function rebuildTaskTypes(db: DatabaseConnection): void {
  db.exec(`
    DROP TABLE IF EXISTS task_types_v2;
    CREATE TABLE task_types_v2 (
      id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES task_boards(id) ON DELETE CASCADE,
      name TEXT NOT NULL, position INTEGER NOT NULL
    );
    INSERT INTO task_types_v2 SELECT id, board_id, name, position FROM task_types;
    DROP TABLE task_types;
    ALTER TABLE task_types_v2 RENAME TO task_types;
  `);
}

function rebuildTasks(db: DatabaseConnection): void {
  db.exec(`
    DROP TABLE IF EXISTS tasks_v2;
    CREATE TABLE tasks_v2 (
      id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES task_boards(id) ON DELETE CASCADE,
      title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL REFERENCES task_types(id),
      priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
      due_at TEXT, remind_at TEXT, reminder_fired_at TEXT,
      source_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO tasks_v2
      SELECT id, board_id, title, description, position, status, priority, due_at, remind_at,
        reminder_fired_at, source_conversation_id, created_at, updated_at FROM tasks;
    DROP TABLE tasks;
    ALTER TABLE tasks_v2 RENAME TO tasks;
  `);
}

function migrateLegacyReasoningSelection(db: DatabaseConnection): void {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'reasoning_level'").get() as Row | undefined;
  if (!row) return;
  let value: unknown;
  try { value = JSON.parse(String(row.value)); } catch { return; }
  if (value === 'off' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' || value === 'max') {
    db.prepare("UPDATE conversations SET reasoning_level = ? WHERE reasoning_level = 'default'").run(value);
  }
}

function addColumn(db: DatabaseConnection, table: string, column: string, definition: string): void {
  if (!tableExists(db, table) || columnNames(db, table).has(column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function tableExists(db: DatabaseConnection, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function columnNames(db: DatabaseConnection, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((row) => String(row.name)));
}

function dropSearchTriggers(db: DatabaseConnection): void {
  for (const name of [
    'search_conversations_insert', 'search_conversations_update', 'search_conversations_delete',
    'search_messages_insert', 'search_messages_update', 'search_messages_delete',
    'search_boards_insert', 'search_boards_update', 'search_boards_delete',
    'search_tasks_insert', 'search_tasks_update', 'search_tasks_delete',
    'search_notes_insert', 'search_notes_update', 'search_notes_delete',
  ]) db.exec(`DROP TRIGGER IF EXISTS ${name}`);
}
