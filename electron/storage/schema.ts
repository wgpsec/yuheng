import type { DatabaseSync } from 'node:sqlite';
import type { Migration } from './migration';

type Row = Record<string, unknown>;

export type LegacyV1Variant =
  | 'initial'
  | 'provider-context'
  | 'run-artifacts'
  | 'task-board'
  | 'notes'
  | 'current';

export type LegacyV1Inspection = {
  recognized: boolean;
  variant: LegacyV1Variant | 'unknown';
  canonical: boolean;
  tables: string[];
};

export type SchemaInvariantResult = {
  ok: boolean;
  violations: string[];
  indexes: string[];
};

export type CanonicalSchemaResult = Pick<SchemaInvariantResult, 'ok' | 'violations'>;

export const CANONICAL_INDEXES = [
  'idx_conversations_project_updated',
  'idx_knowledge_bases_position',
  'idx_note_versions_note_created',
  'idx_notes_knowledge_base_parent_position',
  'idx_run_artifacts_activity',
  'idx_tasks_board_status_updated',
] as const;

export const CANONICAL_BUSINESS_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  app_settings: ['key', 'value', 'updated_at'],
  conversation_projects: ['id', 'name', 'position', 'workspace_path', 'created_at', 'updated_at'],
  conversations: ['id', 'project_id', 'title', 'description', 'archived', 'pinned', 'reasoning_level', 'provider_id', 'profile_id', 'workspace_path', 'created_at', 'updated_at'],
  messages: ['id', 'conversation_id', 'role', 'content', 'created_at'],
  knowledge_bases: ['id', 'name', 'icon', 'color', 'position', 'archived', 'created_at', 'updated_at'],
  note_versions: ['id', 'note_id', 'title', 'content', 'icon', 'cover', 'properties_json', 'created_at'],
  notes: ['id', 'knowledge_base_id', 'parent_id', 'title', 'content', 'icon', 'cover', 'properties_json', 'position', 'archived', 'favorite', 'last_opened_at', 'created_at', 'updated_at'],
  provider_profiles: ['id', 'protocol', 'base_url', 'model', 'display_name', 'context_window', 'updated_at'],
  run_activities: ['id', 'run_id', 'tool_call_id', 'tool_name', 'status', 'input', 'output', 'started_at', 'finished_at'],
  run_artifacts: ['id', 'run_id', 'tool_call_id', 'kind', 'mime_type', 'size', 'url', 'created_at'],
  runs: ['id', 'conversation_id', 'input_message_id', 'status', 'error', 'started_at', 'finished_at', 'input_tokens', 'output_tokens', 'total_tokens', 'context_tokens', 'context_window', 'context_percent'],
  task_boards: ['id', 'name', 'position'],
  task_types: ['id', 'board_id', 'name', 'position'],
  tasks: ['id', 'board_id', 'title', 'description', 'position', 'status', 'priority', 'due_at', 'remind_at', 'reminder_fired_at', 'source_conversation_id', 'created_at', 'updated_at'],
};

const INITIAL_TABLES = ['conversations', 'messages', 'provider_profiles', 'runs'] as const;

export function createCanonicalBusinessSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL, workspace_path TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS provider_profiles (
      id TEXT PRIMARY KEY,
      protocol TEXT NOT NULL CHECK (protocol IN ('openai', 'anthropic')),
      base_url TEXT NOT NULL, model TEXT NOT NULL, display_name TEXT NOT NULL,
      context_window INTEGER NOT NULL DEFAULT 200000, supports_images INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL DEFAULT 'personal' REFERENCES conversation_projects(id),
      title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      archived INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0,
      reasoning_level TEXT NOT NULL DEFAULT 'default', provider_id TEXT,
      profile_id TEXT NOT NULL DEFAULT 'assistant', workspace_path TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      input_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
      status TEXT NOT NULL, error TEXT, started_at TEXT NOT NULL, finished_at TEXT,
      input_tokens INTEGER, output_tokens INTEGER, total_tokens INTEGER,
      context_tokens INTEGER, context_window INTEGER, context_percent REAL
    );
    CREATE TABLE IF NOT EXISTS run_activities (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      tool_call_id TEXT NOT NULL, tool_name TEXT NOT NULL, status TEXT NOT NULL,
      input TEXT, output TEXT, started_at TEXT NOT NULL, finished_at TEXT
    );
    CREATE TABLE IF NOT EXISTS run_artifacts (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      tool_call_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('browser_screenshot', 'computer_screenshot')),
      mime_type TEXT NOT NULL, size INTEGER NOT NULL, url TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_boards (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_types (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL REFERENCES task_boards(id) ON DELETE CASCADE,
      name TEXT NOT NULL, position INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL REFERENCES task_boards(id) ON DELETE CASCADE,
      title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL REFERENCES task_types(id),
      priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
      due_at TEXT, remind_at TEXT, reminder_fired_at TEXT,
      source_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS knowledge_bases (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, color TEXT,
      position INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      knowledge_base_id TEXT NOT NULL DEFAULT 'default' REFERENCES knowledge_bases(id) ON DELETE RESTRICT,
      parent_id TEXT REFERENCES notes(id) ON DELETE CASCADE,
      title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', icon TEXT, cover TEXT,
      properties_json TEXT NOT NULL DEFAULT '{}', position INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0, favorite INTEGER NOT NULL DEFAULT 0,
      last_opened_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS note_versions (
      id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      title TEXT NOT NULL, content TEXT NOT NULL, icon TEXT, cover TEXT,
      properties_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_board_status_updated ON tasks(board_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_conversations_project_updated ON conversations(project_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_run_artifacts_activity ON run_artifacts(run_id, tool_call_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_knowledge_bases_position ON knowledge_bases(archived, position, id);
    CREATE INDEX IF NOT EXISTS idx_note_versions_note_created ON note_versions(note_id, created_at DESC);
  `);
  if (columnNames(db, 'notes').has('knowledge_base_id')) {
    db.exec('CREATE INDEX IF NOT EXISTS idx_notes_knowledge_base_parent_position ON notes(knowledge_base_id, parent_id, archived, position, id)');
  } else {
    db.exec('CREATE INDEX IF NOT EXISTS idx_notes_parent_position ON notes(parent_id, archived, position, id)');
  }
  const now = new Date(0).toISOString();
  db.prepare('INSERT OR IGNORE INTO conversation_projects (id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('personal', '默认', 0, now, now);
  db.prepare('INSERT OR IGNORE INTO knowledge_bases (id, name, position, archived, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)')
    .run('default', '默认知识库', 0, now, now);
  db.prepare('INSERT OR IGNORE INTO task_boards (id, name, position) VALUES (?, ?, ?)').run('default', '默认看板', 0);
  const insertType = db.prepare('INSERT OR IGNORE INTO task_types (id, board_id, name, position) VALUES (?, ?, ?, ?)');
  insertType.run('todo', 'default', '待处理', 0);
  insertType.run('in_progress', 'default', '进行中', 1);
  insertType.run('done', 'default', '已完成', 2);
  insertType.run('archived', 'default', '已归档', 3);
}

export function inspectLegacyV1Schema(db: DatabaseSync): LegacyV1Inspection {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Row[])
    .map((row) => String(row.name));
  const tableSet = new Set(tables);
  const userVersion = Number((db.prepare('PRAGMA user_version').get() as Row).user_version);
  const hasInitialTables = INITIAL_TABLES.every((table) => tableSet.has(table));
  if (userVersion !== 1 || !hasInitialTables) {
    return { recognized: false, variant: 'unknown', canonical: false, tables };
  }

  const providerColumns = columnNames(db, 'provider_profiles');
  const conversationColumns = columnNames(db, 'conversations');
  let variant: LegacyV1Variant;
  if (tableSet.has('notes')) {
    variant = conversationColumns.has('project_id') ? 'current' : 'notes';
  } else if (tableSet.has('tasks')) {
    variant = 'task-board';
  } else if (tableSet.has('run_artifacts')) {
    variant = 'run-artifacts';
  } else if (providerColumns.has('context_window')) {
    variant = 'provider-context';
  } else {
    variant = 'initial';
  }
  return {
    recognized: true,
    variant,
    canonical: false,
    tables,
  };
}

export function validateCanonicalBusinessSchema(db: DatabaseSync): SchemaInvariantResult {
  const violations: string[] = [];
  for (const [table, expectedColumns] of Object.entries(CANONICAL_BUSINESS_COLUMNS)) {
    const actualColumns = columnNames(db, table);
    if (actualColumns.size === 0) {
      violations.push(`missing_table:${table}`);
      continue;
    }
    for (const column of expectedColumns) {
      if (!actualColumns.has(column)) violations.push(`missing_column:${table}.${column}`);
    }
  }
  const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Row[])
    .map((row) => String(row.name))
    .filter((name) => CANONICAL_INDEXES.includes(name as typeof CANONICAL_INDEXES[number]));
  for (const index of CANONICAL_INDEXES) {
    if (!indexes.includes(index)) violations.push(`missing_index:${index}`);
  }
  validateRequiredColumns(db, violations);
  validateRequiredForeignKeys(db, violations);
  validateCheckConstraints(db, violations);
  validateSeeds(db, violations);
  return { ok: violations.length === 0, violations, indexes };
}

export function validateCanonicalSchema(db: DatabaseSync, registry: readonly Migration[]): CanonicalSchemaResult {
  const business = validateCanonicalBusinessSchema(db);
  const violations = [...business.violations];
  const targetVersion = registry.length;
  const userVersion = Number((db.prepare('PRAGMA user_version').get() as Row).user_version);
  if (userVersion !== targetVersion) violations.push(`user_version:${userVersion}:${targetVersion}`);

  const ledgerColumns = columnNames(db, 'schema_migrations');
  for (const column of ['version', 'name', 'checksum', 'app_version', 'source', 'applied_at']) {
    if (!ledgerColumns.has(column)) violations.push(`missing_column:schema_migrations.${column}`);
  }
  if (ledgerColumns.size > 0) {
    const ledger = db.prepare('SELECT version, name, checksum, source FROM schema_migrations ORDER BY version').all() as Row[];
    if (ledger.length !== targetVersion) violations.push(`ledger_length:${ledger.length}:${targetVersion}`);
    registry.forEach((migration, index) => {
      const row = ledger[index];
      if (!row || Number(row.version) !== migration.version) violations.push(`ledger_gap:${migration.version}`);
      else {
        if (String(row.name) !== migration.name) violations.push(`ledger_name:${migration.version}`);
        if (String(row.checksum) !== migration.checksum) violations.push(`ledger_checksum:${migration.version}`);
        if (row.source !== 'applied' && row.source !== 'adopted') violations.push(`ledger_source:${migration.version}`);
      }
    });
  }
  return { ok: violations.length === 0, violations };
}

function validateRequiredColumns(db: DatabaseSync, violations: string[]): void {
  const requiredNotNull: Readonly<Record<string, readonly string[]>> = {
    conversations: ['project_id', 'title', 'description', 'archived', 'pinned', 'reasoning_level', 'profile_id', 'created_at', 'updated_at'],
    provider_profiles: ['protocol', 'base_url', 'model', 'display_name', 'context_window', 'updated_at'],
    tasks: ['board_id', 'title', 'description', 'position', 'status', 'priority', 'created_at', 'updated_at'],
    notes: ['title', 'content', 'properties_json', 'position', 'archived', 'favorite', 'created_at', 'updated_at'],
  };
  for (const [table, columns] of Object.entries(requiredNotNull)) {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Row[];
    for (const column of columns) {
      const row = rows.find((candidate) => candidate.name === column);
      if (row && Number(row.notnull) !== 1) violations.push(`nullable_column:${table}.${column}`);
    }
  }
}

function validateRequiredForeignKeys(db: DatabaseSync, violations: string[]): void {
  const expected: Readonly<Record<string, readonly [string, string, string, string][]>> = {
    conversations: [['project_id', 'conversation_projects', 'id', 'NO ACTION']],
    messages: [['conversation_id', 'conversations', 'id', 'CASCADE']],
    runs: [['conversation_id', 'conversations', 'id', 'CASCADE'], ['input_message_id', 'messages', 'id', 'SET NULL']],
    run_activities: [['run_id', 'runs', 'id', 'CASCADE']],
    run_artifacts: [['run_id', 'runs', 'id', 'CASCADE']],
    task_types: [['board_id', 'task_boards', 'id', 'CASCADE']],
    tasks: [['board_id', 'task_boards', 'id', 'CASCADE'], ['status', 'task_types', 'id', 'NO ACTION'], ['source_conversation_id', 'conversations', 'id', 'SET NULL']],
    notes: [['knowledge_base_id', 'knowledge_bases', 'id', 'RESTRICT'], ['parent_id', 'notes', 'id', 'CASCADE']],
    note_versions: [['note_id', 'notes', 'id', 'CASCADE']],
  };
  for (const [table, foreignKeys] of Object.entries(expected)) {
    const actual = db.prepare(`PRAGMA foreign_key_list(${table})`).all() as Row[];
    for (const [from, targetTable, to, onDelete] of foreignKeys) {
      if (!actual.some((row) => row.from === from && row.table === targetTable && row.to === to && row.on_delete === onDelete)) {
        violations.push(`missing_foreign_key:${table}.${from}`);
      }
    }
  }
}

function validateCheckConstraints(db: DatabaseSync, violations: string[]): void {
  const expected: Readonly<Record<string, readonly string[]>> = {
    provider_profiles: ["protocolin('openai','anthropic')"],
    messages: ["rolein('user','assistant')"],
    run_artifacts: ["kindin('browser_screenshot','computer_screenshot')"],
    tasks: ["priorityin('low','medium','high')"],
  };
  for (const [table, fragments] of Object.entries(expected)) {
    const sql = String((db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as Row | undefined)?.sql ?? '')
      .toLowerCase().replace(/[\s"]/gu, '');
    for (const fragment of fragments) {
      if (!sql.includes(fragment)) violations.push(`missing_check:${table}`);
    }
  }
}

function validateSeeds(db: DatabaseSync, violations: string[]): void {
  if (!db.prepare("SELECT 1 FROM conversation_projects WHERE id = 'personal'").get()) violations.push('missing_seed:conversation_project');
  if (!db.prepare("SELECT 1 FROM knowledge_bases WHERE id = 'default'").get()) violations.push('missing_seed:knowledge_base');
  const boards = db.prepare('SELECT id FROM task_boards').all() as Row[];
  if (boards.length === 0) violations.push('missing_seed:task_board');
  for (const board of boards) {
    if (!db.prepare('SELECT 1 FROM task_types WHERE board_id = ? LIMIT 1').get(String(board.id))) {
      violations.push(`missing_seed:task_type.${String(board.id)}`);
    }
  }
}

function columnNames(db: DatabaseSync, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((row) => String(row.name)));
}
