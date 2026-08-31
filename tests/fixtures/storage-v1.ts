import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type LegacyV1Variant =
  | 'initial'
  | 'provider-context'
  | 'run-artifacts'
  | 'task-board'
  | 'notes'
  | 'current';

const NOW = '2026-08-27T00:00:00.000Z';

export function createLegacyV1Fixture(dataDir: string, variant: LegacyV1Variant): string {
  fs.mkdirSync(dataDir, { recursive: true });
  const databasePath = path.join(dataDir, 'yuheng.sqlite');
  const db = new DatabaseSync(databasePath);
  try {
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        input_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
        status TEXT NOT NULL,
        error TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE TABLE provider_profiles (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        protocol TEXT NOT NULL CHECK (protocol IN ('openai', 'anthropic')),
        base_url TEXT NOT NULL,
        model TEXT NOT NULL,
        display_name TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      PRAGMA user_version = 1;
    `);
    db.prepare('INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('fixture-conversation', '脱敏会话', NOW, NOW);
    db.prepare('INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('fixture-message', 'fixture-conversation', 'user', '脱敏内容', NOW);
    db.prepare('INSERT INTO runs (id, conversation_id, input_message_id, status, started_at) VALUES (?, ?, ?, ?, ?)')
      .run('fixture-run', 'fixture-conversation', 'fixture-message', 'completed', NOW);
    db.prepare('INSERT INTO provider_profiles (id, protocol, base_url, model, display_name, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(1, 'openai', 'https://example.invalid/v1', 'fixture-model', '脱敏 Provider', NOW);

    if (variant !== 'initial') addProviderContextWindow(db);
    if (variant === 'run-artifacts' || variant === 'task-board' || variant === 'notes' || variant === 'current') addRunArtifacts(db);
    if (variant === 'task-board' || variant === 'notes' || variant === 'current') addTasks(db);
    if (variant === 'notes' || variant === 'current') addNotes(db);
    if (variant === 'current') addCurrentColumns(db);
  } finally {
    db.close();
  }
  return databasePath;
}

function addProviderContextWindow(db: DatabaseSync): void {
  db.exec('ALTER TABLE provider_profiles ADD COLUMN context_window INTEGER NOT NULL DEFAULT 200000');
}

function addRunArtifacts(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE run_activities (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      tool_call_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      status TEXT NOT NULL,
      input TEXT,
      output TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE TABLE run_artifacts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      tool_call_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind = 'browser_screenshot'),
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      url TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  db.prepare('INSERT INTO run_activities (id, run_id, tool_call_id, tool_name, status, started_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('fixture-activity', 'fixture-run', 'fixture-tool', 'browser', 'completed', NOW);
  db.prepare('INSERT INTO run_artifacts (id, run_id, tool_call_id, kind, mime_type, size, url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('fixture-artifact', 'fixture-run', 'fixture-tool', 'browser_screenshot', 'image/png', 64, 'yuheng-browser-artifact://local/fixture.png', NOW);
}

function addTasks(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE task_boards (id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL);
    CREATE TABLE task_types (id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL);
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'done', 'archived')),
      priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
      due_at TEXT,
      source_conversation_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.prepare('INSERT INTO task_boards (id, name, position) VALUES (?, ?, ?)').run('default', '默认看板', 0);
  db.prepare('INSERT INTO task_types (id, name, position) VALUES (?, ?, ?)').run('todo', '待处理', 0);
  db.prepare('INSERT INTO tasks (id, title, status, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('fixture-task', '脱敏任务', 'todo', 'medium', NOW, NOW);
}

function addNotes(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE notes (
      id TEXT PRIMARY KEY,
      parent_id TEXT REFERENCES notes(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE note_versions (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  db.prepare('INSERT INTO notes (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('fixture-note', '脱敏笔记', '脱敏正文', NOW, NOW);
  db.prepare('INSERT INTO note_versions (id, note_id, title, content, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('fixture-note-version', 'fixture-note', '脱敏笔记', '脱敏正文', NOW);
}

function addCurrentColumns(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE conversation_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO conversation_projects VALUES ('personal', '个人事务', 0, '${NOW}', '${NOW}');
    ALTER TABLE conversations ADD COLUMN description TEXT NOT NULL DEFAULT '';
    ALTER TABLE conversations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE conversations ADD COLUMN reasoning_level TEXT NOT NULL DEFAULT 'default';
    ALTER TABLE conversations ADD COLUMN provider_id TEXT;
    ALTER TABLE conversations ADD COLUMN profile_id TEXT NOT NULL DEFAULT 'assistant';
    ALTER TABLE conversations ADD COLUMN project_id TEXT REFERENCES conversation_projects(id);
    UPDATE conversations SET project_id = 'personal';
    ALTER TABLE runs ADD COLUMN input_tokens INTEGER;
    ALTER TABLE runs ADD COLUMN output_tokens INTEGER;
    ALTER TABLE runs ADD COLUMN total_tokens INTEGER;
    ALTER TABLE runs ADD COLUMN context_tokens INTEGER;
    ALTER TABLE runs ADD COLUMN context_window INTEGER;
    ALTER TABLE runs ADD COLUMN context_percent REAL;
    ALTER TABLE task_types ADD COLUMN board_id TEXT NOT NULL DEFAULT 'default';
    ALTER TABLE tasks ADD COLUMN board_id TEXT NOT NULL DEFAULT 'default';
    ALTER TABLE tasks ADD COLUMN description TEXT NOT NULL DEFAULT '';
    ALTER TABLE tasks ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE tasks ADD COLUMN remind_at TEXT;
    ALTER TABLE tasks ADD COLUMN reminder_fired_at TEXT;
    ALTER TABLE notes ADD COLUMN icon TEXT;
    ALTER TABLE notes ADD COLUMN cover TEXT;
    ALTER TABLE notes ADD COLUMN properties_json TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE notes ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE notes ADD COLUMN last_opened_at TEXT;
    ALTER TABLE note_versions ADD COLUMN icon TEXT;
    ALTER TABLE note_versions ADD COLUMN cover TEXT;
    ALTER TABLE note_versions ADD COLUMN properties_json TEXT NOT NULL DEFAULT '{}';
  `);
}
