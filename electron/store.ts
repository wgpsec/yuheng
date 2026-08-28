import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type ProviderConfig = {
  protocol: 'openai' | 'anthropic';
  baseUrl: string;
  model: string;
  displayName: string;
  hasApiKey: boolean;
};
export type BrowserUseConfig = { enabled: boolean };
export type ComputerUseConfig = { enabled: boolean };
export type ReasoningSelection = 'default' | 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type Conversation = { id: string; title: string; updatedAt: string; archived: boolean; pinned: boolean };
export type Message = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string };
export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type RunActivityStatus = 'running' | 'completed' | 'failed' | 'cancelled';
export type RunArtifact = { id: string; kind: 'browser_screenshot' | 'computer_screenshot'; mimeType: string; size: number; url: string };
export type RunActivity = { id: string; toolName: string; status: RunActivityStatus; input: string | null; output: string | null; startedAt: string; finishedAt: string | null; artifacts: RunArtifact[] };
export type RunSummary = { id: string; conversationId: string; status: RunStatus; error: string | null; startedAt: string; finishedAt: string | null; inputMessageId: string | null; activities: RunActivity[] };
export const DEFAULT_TASK_BOARD_ID = 'default';
export type TaskBoard = { id: string; name: string; position: number };
export type TaskStatus = string;
export type TaskType = { id: string; boardId: string; name: string; position: number };
export type TaskPriority = 'low' | 'medium' | 'high';
export type Task = {
  id: string;
  boardId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
  remindAt: string | null;
  reminderFiredAt: string | null;
  sourceConversationId: string | null;
  createdAt: string;
  updatedAt: string;
};
export type CreateTaskInput = Pick<Task, 'title'> & Partial<Pick<Task, 'description' | 'status' | 'priority' | 'dueAt' | 'remindAt' | 'sourceConversationId'>>;
export type UpdateTaskInput = Partial<Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'dueAt' | 'remindAt'>>;
export type SearchResultKind = 'conversation' | 'message' | 'task' | 'board';
export type SearchResult = {
  kind: SearchResultKind;
  id: string;
  parentId: string | null;
  title: string;
  snippet: string;
  context: string;
  updatedAt: string;
  archived: boolean;
};

type Row = Record<string, unknown>;

const MAX_SEARCH_QUERY_LENGTH = 120;
const MAX_SEARCH_RESULTS = 50;

function searchSnippet(value: string, query: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  const maximumLength = 150;
  if (!query || normalized.length <= maximumLength) return normalized;
  const matchIndex = normalized.toLocaleLowerCase('zh-CN').indexOf(query.toLocaleLowerCase('zh-CN'));
  const start = Math.max(0, matchIndex < 0 ? 0 : matchIndex - 45);
  const end = Math.min(normalized.length, start + maximumLength);
  return `${start > 0 ? '…' : ''}${normalized.slice(start, end).trim()}${end < normalized.length ? '…' : ''}`;
}

export class AppStore {
  private readonly db: DatabaseSync;
  private searchIndexAvailable = false;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, 'yuheng.sqlite'));
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        archived INTEGER NOT NULL DEFAULT 0,
        pinned INTEGER NOT NULL DEFAULT 0,
        reasoning_level TEXT NOT NULL DEFAULT 'default',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        input_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
        status TEXT NOT NULL,
        error TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE TABLE IF NOT EXISTS run_activities (
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
      CREATE TABLE IF NOT EXISTS run_artifacts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        tool_call_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('browser_screenshot', 'computer_screenshot')),
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        url TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS provider_profiles (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        protocol TEXT NOT NULL CHECK (protocol IN ('openai', 'anthropic')),
        base_url TEXT NOT NULL,
        model TEXT NOT NULL,
        display_name TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_boards (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        position INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_types (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL REFERENCES task_boards(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        position INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL REFERENCES task_boards(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        status TEXT NOT NULL REFERENCES task_types(id),
        priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
        due_at TEXT,
        remind_at TEXT,
        reminder_fired_at TEXT,
        source_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const runColumns = this.db.prepare('PRAGMA table_info(runs)').all() as Row[];
    if (!runColumns.some((column) => column.name === 'input_message_id')) this.db.exec('ALTER TABLE runs ADD COLUMN input_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL');
    const conversationColumns = this.db.prepare('PRAGMA table_info(conversations)').all() as Row[];
    if (!conversationColumns.some((column) => column.name === 'description')) this.db.exec("ALTER TABLE conversations ADD COLUMN description TEXT NOT NULL DEFAULT ''");
    if (!conversationColumns.some((column) => column.name === 'archived')) this.db.exec('ALTER TABLE conversations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
    if (!conversationColumns.some((column) => column.name === 'pinned')) this.db.exec('ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
    if (!conversationColumns.some((column) => column.name === 'reasoning_level')) this.db.exec("ALTER TABLE conversations ADD COLUMN reasoning_level TEXT NOT NULL DEFAULT 'default'");
    this.migrateLegacyReasoningSelection();
    const taskColumns = this.db.prepare('PRAGMA table_info(tasks)').all() as Row[];
    if (!taskColumns.some((column) => column.name === 'description')) this.db.exec("ALTER TABLE tasks ADD COLUMN description TEXT NOT NULL DEFAULT ''");
    if (!taskColumns.some((column) => column.name === 'remind_at')) this.db.exec('ALTER TABLE tasks ADD COLUMN remind_at TEXT');
    if (!taskColumns.some((column) => column.name === 'reminder_fired_at')) this.db.exec('ALTER TABLE tasks ADD COLUMN reminder_fired_at TEXT');
    this.migrateRunArtifactSchema();
    this.seedTaskBoard();
    this.migrateTaskBoardSchema();
    this.seedTaskTypes();
    this.migrateTaskTypeSchema();
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_board_status_updated ON tasks(board_id, status, updated_at DESC)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_run_artifacts_activity ON run_artifacts(run_id, tool_call_id, created_at ASC)');
    this.seed();
    this.setupSearchIndex();
  }

  private setupSearchIndex(): void {
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
          kind UNINDEXED,
          entity_id UNINDEXED,
          parent_id UNINDEXED,
          title,
          content,
          context UNINDEXED,
          updated_at UNINDEXED,
          archived UNINDEXED,
          tokenize = 'trigram'
        );
        CREATE TRIGGER IF NOT EXISTS search_conversations_insert AFTER INSERT ON conversations BEGIN
          INSERT INTO search_index(kind, entity_id, parent_id, title, content, context, updated_at, archived)
          VALUES ('conversation', NEW.id, NULL, NEW.title, NEW.description, '会话', NEW.updated_at, NEW.archived);
        END;
        CREATE TRIGGER IF NOT EXISTS search_conversations_update AFTER UPDATE ON conversations BEGIN
          DELETE FROM search_index WHERE kind = 'conversation' AND entity_id = OLD.id;
          INSERT INTO search_index(kind, entity_id, parent_id, title, content, context, updated_at, archived)
          VALUES ('conversation', NEW.id, NULL, NEW.title, NEW.description, '会话', NEW.updated_at, NEW.archived);
          UPDATE search_index SET title = NEW.title, archived = NEW.archived
          WHERE kind = 'message' AND parent_id = NEW.id;
        END;
        CREATE TRIGGER IF NOT EXISTS search_conversations_delete AFTER DELETE ON conversations BEGIN
          DELETE FROM search_index WHERE (kind = 'conversation' AND entity_id = OLD.id) OR (kind = 'message' AND parent_id = OLD.id);
        END;
        CREATE TRIGGER IF NOT EXISTS search_messages_insert AFTER INSERT ON messages BEGIN
          INSERT INTO search_index(kind, entity_id, parent_id, title, content, context, updated_at, archived)
          SELECT 'message', NEW.id, NEW.conversation_id, title, NEW.content,
            CASE NEW.role WHEN 'user' THEN '你' ELSE '玉衡' END, NEW.created_at, archived
          FROM conversations WHERE id = NEW.conversation_id;
        END;
        CREATE TRIGGER IF NOT EXISTS search_messages_update AFTER UPDATE ON messages BEGIN
          DELETE FROM search_index WHERE kind = 'message' AND entity_id = OLD.id;
          INSERT INTO search_index(kind, entity_id, parent_id, title, content, context, updated_at, archived)
          SELECT 'message', NEW.id, NEW.conversation_id, title, NEW.content,
            CASE NEW.role WHEN 'user' THEN '你' ELSE '玉衡' END, NEW.created_at, archived
          FROM conversations WHERE id = NEW.conversation_id;
        END;
        CREATE TRIGGER IF NOT EXISTS search_messages_delete AFTER DELETE ON messages BEGIN
          DELETE FROM search_index WHERE kind = 'message' AND entity_id = OLD.id;
        END;
        CREATE TRIGGER IF NOT EXISTS search_boards_insert AFTER INSERT ON task_boards BEGIN
          INSERT INTO search_index(kind, entity_id, parent_id, title, content, context, updated_at, archived)
          VALUES ('board', NEW.id, NULL, NEW.name, '', '任务看板', '', 0);
        END;
        CREATE TRIGGER IF NOT EXISTS search_boards_update AFTER UPDATE ON task_boards BEGIN
          DELETE FROM search_index WHERE kind = 'board' AND entity_id = OLD.id;
          INSERT INTO search_index(kind, entity_id, parent_id, title, content, context, updated_at, archived)
          VALUES ('board', NEW.id, NULL, NEW.name, '', '任务看板', '', 0);
          UPDATE search_index SET context = NEW.name WHERE kind = 'task' AND parent_id = NEW.id;
        END;
        CREATE TRIGGER IF NOT EXISTS search_boards_delete AFTER DELETE ON task_boards BEGIN
          DELETE FROM search_index WHERE (kind = 'board' AND entity_id = OLD.id) OR (kind = 'task' AND parent_id = OLD.id);
        END;
        CREATE TRIGGER IF NOT EXISTS search_tasks_insert AFTER INSERT ON tasks BEGIN
          INSERT INTO search_index(kind, entity_id, parent_id, title, content, context, updated_at, archived)
          SELECT 'task', NEW.id, NEW.board_id, NEW.title, NEW.description, name, NEW.updated_at, 0
          FROM task_boards WHERE id = NEW.board_id;
        END;
        CREATE TRIGGER IF NOT EXISTS search_tasks_update AFTER UPDATE ON tasks BEGIN
          DELETE FROM search_index WHERE kind = 'task' AND entity_id = OLD.id;
          INSERT INTO search_index(kind, entity_id, parent_id, title, content, context, updated_at, archived)
          SELECT 'task', NEW.id, NEW.board_id, NEW.title, NEW.description, name, NEW.updated_at, 0
          FROM task_boards WHERE id = NEW.board_id;
        END;
        CREATE TRIGGER IF NOT EXISTS search_tasks_delete AFTER DELETE ON tasks BEGIN
          DELETE FROM search_index WHERE kind = 'task' AND entity_id = OLD.id;
        END;
      `);
      this.rebuildSearchIndex();
      this.searchIndexAvailable = true;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('no such module: fts5')) throw error;
      this.searchIndexAvailable = false;
    }
  }

  private rebuildSearchIndex(): void {
    this.db.exec(`
      DELETE FROM search_index;
      INSERT INTO search_index(kind, entity_id, parent_id, title, content, context, updated_at, archived)
      SELECT 'conversation', id, NULL, title, description, '会话', updated_at, archived FROM conversations;
      INSERT INTO search_index(kind, entity_id, parent_id, title, content, context, updated_at, archived)
      SELECT 'message', messages.id, conversation_id, conversations.title, messages.content,
        CASE messages.role WHEN 'user' THEN '你' ELSE '玉衡' END, messages.created_at, conversations.archived
      FROM messages JOIN conversations ON conversations.id = messages.conversation_id;
      INSERT INTO search_index(kind, entity_id, parent_id, title, content, context, updated_at, archived)
      SELECT 'board', id, NULL, name, '', '任务看板', '', 0 FROM task_boards;
      INSERT INTO search_index(kind, entity_id, parent_id, title, content, context, updated_at, archived)
      SELECT 'task', tasks.id, board_id, tasks.title, tasks.description, task_boards.name, tasks.updated_at, 0
      FROM tasks JOIN task_boards ON task_boards.id = tasks.board_id;
    `);
  }

  search(rawQuery: string, requestedLimit = 30): SearchResult[] {
    const query = rawQuery.replace(/\s+/g, ' ').trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
    const limit = Math.max(1, Math.min(MAX_SEARCH_RESULTS, Math.floor(requestedLimit) || 30));
    if (!query) return this.recentSearchResults(limit);
    if (!this.searchIndexAvailable || [...query].length < 3) return this.searchWithLike(query, limit);

    const match = `"${query.replace(/"/g, '""')}"`;
    try {
      const rows = this.db.prepare(`
        SELECT kind, entity_id AS id, parent_id AS parentId, title,
          snippet(search_index, -1, '', '', ' … ', 24) AS snippet,
          context, updated_at AS updatedAt, archived
        FROM search_index
        WHERE search_index MATCH ?
        ORDER BY bm25(search_index, 0, 0, 0, 5, 1), updated_at DESC
        LIMIT ?
      `).all(match, limit) as Row[];
      return rows.map((row) => this.mapSearchResult(row, query));
    } catch {
      return this.searchWithLike(query, limit);
    }
  }

  private recentSearchResults(limit: number): SearchResult[] {
    const rows = this.db.prepare(`
      SELECT 'conversation' AS kind, id, NULL AS parentId, title, description AS content,
        '会话' AS context, updated_at AS updatedAt, archived
      FROM conversations
      UNION ALL
      SELECT 'task' AS kind, tasks.id, board_id AS parentId, tasks.title, tasks.description AS content,
        task_boards.name AS context, tasks.updated_at AS updatedAt, 0 AS archived
      FROM tasks JOIN task_boards ON task_boards.id = tasks.board_id
      ORDER BY updatedAt DESC
      LIMIT ?
    `).all(limit) as Row[];
    return rows.map((row) => this.mapSearchResult(row, ''));
  }

  private searchWithLike(query: string, limit: number): SearchResult[] {
    const pattern = `%${query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
    const rows = this.db.prepare(`
      SELECT 'conversation' AS kind, id, NULL AS parentId, title, description AS content,
        '会话' AS context, updated_at AS updatedAt, archived
      FROM conversations WHERE title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'
      UNION ALL
      SELECT 'message' AS kind, messages.id, conversation_id AS parentId, conversations.title,
        messages.content, CASE messages.role WHEN 'user' THEN '你' ELSE '玉衡' END AS context,
        messages.created_at AS updatedAt, conversations.archived
      FROM messages JOIN conversations ON conversations.id = messages.conversation_id
      WHERE messages.content LIKE ? ESCAPE '\\'
      UNION ALL
      SELECT 'task' AS kind, tasks.id, board_id AS parentId, tasks.title, tasks.description AS content,
        task_boards.name AS context, tasks.updated_at AS updatedAt, 0 AS archived
      FROM tasks JOIN task_boards ON task_boards.id = tasks.board_id
      WHERE tasks.title LIKE ? ESCAPE '\\' OR tasks.description LIKE ? ESCAPE '\\'
      UNION ALL
      SELECT 'board' AS kind, id, NULL AS parentId, name AS title, '' AS content,
        '任务看板' AS context, '' AS updatedAt, 0 AS archived
      FROM task_boards WHERE name LIKE ? ESCAPE '\\'
      ORDER BY updatedAt DESC
      LIMIT ?
    `).all(pattern, pattern, pattern, pattern, pattern, pattern, limit) as Row[];
    return rows.map((row) => this.mapSearchResult(row, query));
  }

  private mapSearchResult(row: Row, query: string): SearchResult {
    const title = String(row.title ?? '');
    const content = String(row.content ?? row.snippet ?? '');
    const source = content || title;
    return {
      kind: row.kind as SearchResultKind,
      id: String(row.id),
      parentId: row.parentId === null || row.parentId === undefined ? null : String(row.parentId),
      title,
      snippet: searchSnippet(source, query),
      context: String(row.context ?? ''),
      updatedAt: String(row.updatedAt ?? ''),
      archived: Boolean(row.archived),
    };
  }

  private migrateRunArtifactSchema(): void {
    const row = this.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'run_artifacts'").get() as Row | undefined;
    const schema = typeof row?.sql === 'string' ? row.sql : '';
    if (!schema || schema.includes("'computer_screenshot'")) return;
    this.db.exec(`
      BEGIN;
      ALTER TABLE run_artifacts RENAME TO run_artifacts_legacy;
      CREATE TABLE run_artifacts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        tool_call_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('browser_screenshot', 'computer_screenshot')),
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        url TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO run_artifacts (id, run_id, tool_call_id, kind, mime_type, size, url, created_at)
      SELECT id, run_id, tool_call_id, kind, mime_type, size, url, created_at FROM run_artifacts_legacy;
      DROP TABLE run_artifacts_legacy;
      COMMIT;
    `);
  }

  private migrateLegacyReasoningSelection(): void {
    const row = this.db.prepare("SELECT value FROM app_settings WHERE key = 'reasoning_level'").get() as Row | undefined;
    if (!row) return;
    let value: unknown;
    try { value = JSON.parse(String(row.value)); } catch { return; }
    if (value !== 'off' && value !== 'low' && value !== 'medium' && value !== 'high' && value !== 'xhigh' && value !== 'max') return;
    this.db.prepare("UPDATE conversations SET reasoning_level = ? WHERE reasoning_level = 'default'").run(value);
  }

  private seedTaskBoard(): void {
    this.db.prepare('INSERT OR IGNORE INTO task_boards (id, name, position) VALUES (?, ?, ?)').run(DEFAULT_TASK_BOARD_ID, '默认看板', 0);
  }

  private migrateTaskBoardSchema(): void {
    const typeColumns = this.db.prepare('PRAGMA table_info(task_types)').all() as Row[];
    if (!typeColumns.some((column) => column.name === 'board_id')) this.db.exec(`ALTER TABLE task_types ADD COLUMN board_id TEXT NOT NULL DEFAULT '${DEFAULT_TASK_BOARD_ID}'`);
    const taskColumns = this.db.prepare('PRAGMA table_info(tasks)').all() as Row[];
    if (!taskColumns.some((column) => column.name === 'board_id')) this.db.exec(`ALTER TABLE tasks ADD COLUMN board_id TEXT NOT NULL DEFAULT '${DEFAULT_TASK_BOARD_ID}'`);
  }

  private seedTaskTypes(): void {
    const insert = this.db.prepare('INSERT OR IGNORE INTO task_types (id, board_id, name, position) VALUES (?, ?, ?, ?)');
    insert.run('todo', DEFAULT_TASK_BOARD_ID, '待处理', 0);
    insert.run('in_progress', DEFAULT_TASK_BOARD_ID, '进行中', 1);
    insert.run('done', DEFAULT_TASK_BOARD_ID, '已完成', 2);
    insert.run('archived', DEFAULT_TASK_BOARD_ID, '已归档', 3);
  }

  private migrateTaskTypeSchema(): void {
    const row = this.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").get() as Row | undefined;
    const schema = typeof row?.sql === 'string' ? row.sql : '';
    if (!schema.includes("CHECK (status IN ('todo', 'in_progress', 'done', 'archived'))")) return;

    this.db.exec(`
      BEGIN;
      DROP INDEX IF EXISTS idx_tasks_status_updated;
      ALTER TABLE tasks RENAME TO tasks_legacy;
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL REFERENCES task_boards(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL REFERENCES task_types(id),
        priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
        due_at TEXT,
        remind_at TEXT,
        reminder_fired_at TEXT,
        source_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO tasks (id, board_id, title, description, status, priority, due_at, remind_at, reminder_fired_at, source_conversation_id, created_at, updated_at)
      SELECT id, board_id, title, description, status, priority, due_at, remind_at, reminder_fired_at, source_conversation_id, created_at, updated_at FROM tasks_legacy;
      DROP TABLE tasks_legacy;
      COMMIT;
    `);
  }

  private seed(): void {
    const count = (this.db.prepare('SELECT COUNT(*) AS count FROM conversations').get() as Row).count;
    if (Number(count) > 0) return;
    const now = new Date().toISOString();
    const insert = this.db.prepare('INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)');
    insert.run('inbox', '收件箱', now, now);
    insert.run('weekly-plan', '本周计划', now, now);
    insert.run('research', '资料整理', now, now);
    const message = this.db.prepare('INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)');
    message.run('weekly-1', 'weekly-plan', 'user', '帮我整理一下本周最重要的三件事。', now);
    message.run('weekly-2', 'weekly-plan', 'assistant', '可以。先从已经确认的事项开始：项目发布、供应商跟进和周五的复盘。', now);
    message.run('research-1', 'research', 'user', '把上次收集的资料按主题分一下。', now);
    message.run('research-2', 'research', 'assistant', '我先按“产品、技术、待确认”三个主题归类，待确认的内容单独列出。', now);
  }

  listConversations(includeArchived = false): Conversation[] {
    const rows = this.db.prepare(`SELECT id, title, updated_at AS updatedAt, archived, pinned FROM conversations ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY pinned DESC, updated_at DESC`).all() as Row[];
    return rows.map((row) => this.conversationFromRow(row));
  }

  getConversation(id: string): Conversation {
    const row = this.db.prepare('SELECT id, title, updated_at AS updatedAt, archived, pinned FROM conversations WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new Error('Conversation not found.');
    return this.conversationFromRow(row);
  }

  private conversationFromRow(row: Row): Conversation {
    return { id: String(row.id), title: String(row.title), updatedAt: String(row.updatedAt), archived: Number(row.archived) === 1, pinned: Number(row.pinned) === 1 };
  }

  listMessages(conversationId: string): Message[] {
    const rows = this.db.prepare('SELECT id, role, content, created_at AS createdAt FROM messages WHERE conversation_id = ? ORDER BY created_at ASC').all(conversationId) as Row[];
    return rows.map((row) => ({ id: String(row.id), role: row.role as Message['role'], content: String(row.content), createdAt: String(row.createdAt) }));
  }

  createConversation(title = '新会话'): Conversation {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.prepare('INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, title, now, now);
    return { id, title, updatedAt: now, archived: false, pinned: false };
  }

  renameConversation(id: string, title: string): Conversation {
    const normalized = title.trim();
    if (!normalized) throw new Error('Conversation title is required.');
    const now = new Date().toISOString();
    const result = this.db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(normalized, now, id);
    if (Number(result.changes) === 0) throw new Error('Conversation not found.');
    return this.getConversation(id);
  }

  setConversationArchived(id: string, archived: boolean): Conversation {
    const now = new Date().toISOString();
    const result = this.db.prepare('UPDATE conversations SET archived = ?, updated_at = ? WHERE id = ?').run(archived ? 1 : 0, now, id);
    if (Number(result.changes) === 0) throw new Error('Conversation not found.');
    return this.getConversation(id);
  }

  setConversationPinned(id: string, pinned: boolean): Conversation {
    const result = this.db.prepare('UPDATE conversations SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);
    if (Number(result.changes) === 0) throw new Error('Conversation not found.');
    return this.getConversation(id);
  }

  deleteConversation(id: string): void {
    const result = this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
    if (Number(result.changes) === 0) throw new Error('Conversation not found.');
  }

  addMessage(conversationId: string, role: Message['role'], content: string, id = crypto.randomUUID()): Message {
    const createdAt = new Date().toISOString();
    this.db.prepare('INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run(id, conversationId, role, content, createdAt);
    this.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(createdAt, conversationId);
    if (role === 'user') this.setAutomaticConversationTitle(conversationId, content, createdAt);
    return { id, role, content, createdAt };
  }

  private setAutomaticConversationTitle(conversationId: string, content: string, updatedAt: string): void {
    const userMessageCount = Number((this.db.prepare("SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ? AND role = 'user'").get(conversationId) as Row).count);
    if (userMessageCount !== 1) return;
    const title = Array.from(content.replace(/\s+/g, ' ').trim()).slice(0, 32).join('');
    if (!title) return;
    this.db.prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ? AND title = '新会话'").run(title, updatedAt, conversationId);
  }

  updateMessage(id: string, content: string): void {
    this.db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(content, id);
  }

  deleteMessage(id: string): void {
    this.db.prepare('DELETE FROM messages WHERE id = ?').run(id);
  }

  startRun(id: string, conversationId: string, inputMessageId: string): void {
    this.db.prepare('INSERT INTO runs (id, conversation_id, input_message_id, status, started_at) VALUES (?, ?, ?, ?, ?)').run(id, conversationId, inputMessageId, 'running', new Date().toISOString());
  }

  finishRun(id: string, status: Exclude<RunStatus, 'running'>, error?: string): void {
    this.db.prepare('UPDATE runs SET status = ?, error = ?, finished_at = ? WHERE id = ?').run(status, error ?? null, new Date().toISOString(), id);
    const activityStatus: RunActivityStatus = status === 'completed' ? 'completed' : status === 'cancelled' || status === 'interrupted' ? 'cancelled' : 'failed';
    this.db.prepare('UPDATE run_activities SET status = ?, finished_at = COALESCE(finished_at, ?) WHERE run_id = ? AND status = \'running\'').run(activityStatus, new Date().toISOString(), id);
  }

  recoverRunningRuns(): number {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE run_activities SET status = 'cancelled', finished_at = COALESCE(finished_at, ?) WHERE status = 'running' AND run_id IN (SELECT id FROM runs WHERE status = 'running')").run(now);
    const result = this.db.prepare("UPDATE runs SET status = 'interrupted', error = ?, finished_at = ? WHERE status = 'running'").run('应用重启时运行被中断。', now);
    return Number(result.changes);
  }

  startToolActivity(runId: string, toolCallId: string, toolName: string, input?: string): void {
    this.db.prepare('INSERT OR REPLACE INTO run_activities (id, run_id, tool_call_id, tool_name, status, input, output, started_at, finished_at) VALUES (?, ?, ?, ?, \'running\', ?, NULL, ?, NULL)').run(`${runId}:${toolCallId}`, runId, toolCallId, toolName, input ?? null, new Date().toISOString());
  }

  finishToolActivity(runId: string, toolCallId: string, toolName: string, isError: boolean, output?: string): void {
    this.db.prepare('UPDATE run_activities SET tool_name = ?, status = ?, output = ?, finished_at = ? WHERE id = ? AND run_id = ?').run(toolName, isError ? 'failed' : 'completed', output ?? null, new Date().toISOString(), `${runId}:${toolCallId}`, runId);
  }

  addRunArtifact(runId: string, toolCallId: string, artifact: RunArtifact): void {
    this.db.prepare('INSERT INTO run_artifacts (id, run_id, tool_call_id, kind, mime_type, size, url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(artifact.id, runId, toolCallId, artifact.kind, artifact.mimeType, artifact.size, artifact.url, new Date().toISOString());
  }

  private listRunArtifacts(runId: string, toolCallId: string): RunArtifact[] {
    const rows = this.db.prepare('SELECT id, kind, mime_type AS mimeType, size, url FROM run_artifacts WHERE run_id = ? AND tool_call_id = ? ORDER BY created_at ASC, id ASC').all(runId, toolCallId) as Row[];
    return rows.map((row) => ({ id: String(row.id), kind: row.kind as RunArtifact['kind'], mimeType: String(row.mimeType), size: Number(row.size), url: String(row.url) }));
  }

  deleteRunArtifactsBefore(cutoff: string): RunArtifact[] {
    const rows = this.db.prepare('SELECT id, kind, mime_type AS mimeType, size, url FROM run_artifacts WHERE created_at < ?').all(cutoff) as Row[];
    this.db.prepare('DELETE FROM run_artifacts WHERE created_at < ?').run(cutoff);
    return rows.map((row) => ({ id: String(row.id), kind: row.kind as RunArtifact['kind'], mimeType: String(row.mimeType), size: Number(row.size), url: String(row.url) }));
  }

  listRunActivities(runId: string): RunActivity[] {
    const rows = this.db.prepare('SELECT tool_call_id AS id, tool_name AS toolName, status, input, output, started_at AS startedAt, finished_at AS finishedAt FROM run_activities WHERE run_id = ? ORDER BY started_at ASC').all(runId) as Row[];
    return rows.map((row) => ({ id: String(row.id), toolName: String(row.toolName), status: row.status as RunActivityStatus, input: row.input == null ? null : String(row.input), output: row.output == null ? null : String(row.output), startedAt: String(row.startedAt), finishedAt: row.finishedAt == null ? null : String(row.finishedAt), artifacts: this.listRunArtifacts(runId, String(row.id)) }));
  }

  listRuns(conversationId: string): RunSummary[] {
    const rows = this.db.prepare('SELECT id, conversation_id AS conversationId, status, error, started_at AS startedAt, finished_at AS finishedAt, input_message_id AS inputMessageId FROM runs WHERE conversation_id = ? ORDER BY started_at DESC').all(conversationId) as Row[];
    return rows.map((row) => ({ id: String(row.id), conversationId: String(row.conversationId), status: row.status as RunStatus, error: row.error == null ? null : String(row.error), startedAt: String(row.startedAt), finishedAt: row.finishedAt == null ? null : String(row.finishedAt), inputMessageId: row.inputMessageId == null ? null : String(row.inputMessageId), activities: this.listRunActivities(String(row.id)) }));
  }

  private taskFromRow(row: Row): Task {
    return {
      id: String(row.id),
      boardId: String(row.boardId),
      title: String(row.title),
      description: String(row.description ?? ''),
      status: row.status as TaskStatus,
      priority: row.priority as TaskPriority,
      dueAt: row.dueAt == null ? null : String(row.dueAt),
      remindAt: row.remindAt == null ? null : String(row.remindAt),
      reminderFiredAt: row.reminderFiredAt == null ? null : String(row.reminderFiredAt),
      sourceConversationId: row.sourceConversationId == null ? null : String(row.sourceConversationId),
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
    };
  }

  listTaskBoards(): TaskBoard[] {
    const rows = this.db.prepare('SELECT id, name, position FROM task_boards ORDER BY position ASC, id ASC').all() as Row[];
    return rows.map((row) => ({ id: String(row.id), name: String(row.name), position: Number(row.position) }));
  }

  createTaskBoard(name: string): TaskBoard {
    const normalized = name.trim();
    if (!normalized) throw new Error('Task board name is required.');
    const id = crypto.randomUUID();
    const nextPosition = Number((this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM task_boards').get() as Row).position);
    this.db.exec('BEGIN');
    try {
      this.db.prepare('INSERT INTO task_boards (id, name, position) VALUES (?, ?, ?)').run(id, normalized, nextPosition);
      const insertType = this.db.prepare('INSERT INTO task_types (id, board_id, name, position) VALUES (?, ?, ?, ?)');
      for (const [suffix, typeName, position] of [['todo', '待处理', 0], ['in_progress', '进行中', 1], ['done', '已完成', 2], ['archived', '已归档', 3]] as const) {
        insertType.run(`${id}:${suffix}`, id, typeName, position);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { id, name: normalized, position: nextPosition };
  }

  renameTaskBoard(id: string, name: string): TaskBoard {
    const normalized = name.trim();
    if (!normalized) throw new Error('Task board name is required.');
    const result = this.db.prepare('UPDATE task_boards SET name = ? WHERE id = ?').run(normalized, id);
    if (Number(result.changes) === 0) throw new Error('Task board not found.');
    const row = this.db.prepare('SELECT id, name, position FROM task_boards WHERE id = ?').get(id) as Row;
    return { id: String(row.id), name: String(row.name), position: Number(row.position) };
  }

  listTasks(boardId = DEFAULT_TASK_BOARD_ID): Task[] {
    const rows = this.db.prepare(`SELECT id, board_id AS boardId, title, description, status, priority, due_at AS dueAt, remind_at AS remindAt, reminder_fired_at AS reminderFiredAt,
      source_conversation_id AS sourceConversationId, created_at AS createdAt, updated_at AS updatedAt
      FROM tasks WHERE board_id = ? ORDER BY updated_at DESC`).all(boardId) as Row[];
    return rows.map((row) => this.taskFromRow(row));
  }

  listTaskTypes(boardId = DEFAULT_TASK_BOARD_ID): TaskType[] {
    const rows = this.db.prepare('SELECT id, board_id AS boardId, name, position FROM task_types WHERE board_id = ? ORDER BY position ASC, id ASC').all(boardId) as Row[];
    return rows.map((row) => ({ id: String(row.id), boardId: String(row.boardId), name: String(row.name), position: Number(row.position) }));
  }

  createTaskType(name: string, boardId = DEFAULT_TASK_BOARD_ID): TaskType {
    const normalized = name.trim();
    if (!normalized) throw new Error('Task type name is required.');
    const id = crypto.randomUUID();
    const nextPosition = Number((this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM task_types WHERE board_id = ?').get(boardId) as Row).position);
    this.db.prepare('INSERT INTO task_types (id, board_id, name, position) VALUES (?, ?, ?, ?)').run(id, boardId, normalized, nextPosition);
    return { id, boardId, name: normalized, position: nextPosition };
  }

  renameTaskType(id: string, name: string): TaskType {
    const normalized = name.trim();
    if (!normalized) throw new Error('Task type name is required.');
    const result = this.db.prepare('UPDATE task_types SET name = ? WHERE id = ?').run(normalized, id);
    if (Number(result.changes) === 0) throw new Error('Task type not found.');
    const row = this.db.prepare('SELECT id, board_id AS boardId, name, position FROM task_types WHERE id = ?').get(id) as Row;
    return { id: String(row.id), boardId: String(row.boardId), name: String(row.name), position: Number(row.position) };
  }

  private assertTaskStatus(status: TaskStatus, boardId: string): void {
    const row = this.db.prepare('SELECT 1 FROM task_types WHERE id = ? AND board_id = ?').get(status, boardId);
    if (!row) throw new Error('Task type not found.');
  }

  createTask(input: CreateTaskInput, boardId = DEFAULT_TASK_BOARD_ID): Task {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const status = input.status ?? this.listTaskTypes(boardId)[0]?.id;
    if (!status) throw new Error('At least one task type is required.');
    this.assertTaskStatus(status, boardId);
    this.db.prepare(`INSERT INTO tasks
      (id, board_id, title, description, status, priority, due_at, remind_at, source_conversation_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, boardId, input.title, input.description ?? '', status, input.priority ?? 'medium', input.dueAt ?? null, input.remindAt ?? null, input.sourceConversationId ?? null, now, now);
    return this.getTask(id);
  }

  updateTask(id: string, patch: UpdateTaskInput): Task {
    const existing = this.getTask(id);
    if (patch.status !== undefined) this.assertTaskStatus(patch.status, existing.boardId);
    const assignments: string[] = [];
    const values: (string | null)[] = [];
    for (const [key, column] of [['title', 'title'], ['description', 'description'], ['status', 'status'], ['priority', 'priority'], ['dueAt', 'due_at'], ['remindAt', 'remind_at']] as const) {
      if (patch[key] === undefined) continue;
      assignments.push(`${column} = ?`);
      values.push(patch[key] ?? null);
    }
    if (assignments.length === 0) return this.getTask(id);
    if (patch.remindAt !== undefined && patch.remindAt !== existing.remindAt) assignments.push('reminder_fired_at = NULL');
    assignments.push('updated_at = ?');
    values.push(new Date().toISOString(), id);
    const result = this.db.prepare(`UPDATE tasks SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
    if (Number(result.changes) === 0) throw new Error('Task not found.');
    return this.getTask(id);
  }

  getTask(id: string): Task {
    const row = this.db.prepare(`SELECT id, board_id AS boardId, title, description, status, priority, due_at AS dueAt, remind_at AS remindAt, reminder_fired_at AS reminderFiredAt,
      source_conversation_id AS sourceConversationId, created_at AS createdAt, updated_at AS updatedAt
      FROM tasks WHERE id = ?`).get(id) as Row | undefined;
    if (!row) throw new Error('Task not found.');
    return this.taskFromRow(row);
  }

  listPendingTaskReminders(): Task[] {
    const rows = this.db.prepare(`SELECT id, board_id AS boardId, title, description, status, priority, due_at AS dueAt, remind_at AS remindAt, reminder_fired_at AS reminderFiredAt,
      source_conversation_id AS sourceConversationId, created_at AS createdAt, updated_at AS updatedAt
      FROM tasks
      WHERE remind_at IS NOT NULL AND reminder_fired_at IS NULL
        AND status != 'done' AND status != 'archived'
        AND status NOT LIKE '%:done' AND status NOT LIKE '%:archived'
      ORDER BY remind_at ASC`).all() as Row[];
    return rows.map((row) => this.taskFromRow(row));
  }

  markTaskReminderFired(id: string, expectedRemindAt: string, firedAt = new Date().toISOString()): Task | null {
    const result = this.db.prepare(`UPDATE tasks SET reminder_fired_at = ?
      WHERE id = ? AND remind_at = ? AND reminder_fired_at IS NULL`).run(firedAt, id, expectedRemindAt);
    return Number(result.changes) === 0 ? null : this.getTask(id);
  }

  getProvider(): ProviderConfig | null {
    const row = this.db.prepare('SELECT protocol, base_url AS baseUrl, model, display_name AS displayName FROM provider_profiles WHERE id = 1').get() as Row | undefined;
    if (!row) return null;
    return { protocol: row.protocol as ProviderConfig['protocol'], baseUrl: String(row.baseUrl), model: String(row.model), displayName: String(row.displayName), hasApiKey: false };
  }

  saveProvider(config: Omit<ProviderConfig, 'hasApiKey'>): ProviderConfig {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO provider_profiles (id, protocol, base_url, model, display_name, updated_at) VALUES (1, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET protocol=excluded.protocol, base_url=excluded.base_url, model=excluded.model, display_name=excluded.display_name, updated_at=excluded.updated_at`).run(config.protocol, config.baseUrl, config.model, config.displayName, now);
    return { ...config, hasApiKey: true };
  }

  getBrowserUseConfig(): BrowserUseConfig {
    const row = this.db.prepare("SELECT value FROM app_settings WHERE key = 'browser_use'").get() as Row | undefined;
    if (!row) return { enabled: false };
    try {
      const value: unknown = JSON.parse(String(row.value));
      return { enabled: Boolean(value && typeof value === 'object' && (value as Record<string, unknown>).enabled === true) };
    } catch {
      return { enabled: false };
    }
  }

  saveBrowserUseConfig(config: BrowserUseConfig): BrowserUseConfig {
    const normalized = { enabled: config.enabled === true };
    const now = new Date().toISOString();
    this.db.exec('BEGIN');
    try {
      this.db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('browser_use', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
        .run(JSON.stringify(normalized), now);
      if (normalized.enabled) {
        this.db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('computer_use', ?, ?)
          ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
          .run(JSON.stringify({ enabled: false }), now);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return normalized;
  }

  getComputerUseConfig(): ComputerUseConfig {
    const row = this.db.prepare("SELECT value FROM app_settings WHERE key = 'computer_use'").get() as Row | undefined;
    if (!row) return { enabled: false };
    try {
      const value: unknown = JSON.parse(String(row.value));
      return { enabled: Boolean(value && typeof value === 'object' && (value as Record<string, unknown>).enabled === true) };
    } catch {
      return { enabled: false };
    }
  }

  saveComputerUseConfig(config: ComputerUseConfig): ComputerUseConfig {
    const normalized = { enabled: config.enabled === true };
    const now = new Date().toISOString();
    this.db.exec('BEGIN');
    try {
      this.db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('computer_use', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
        .run(JSON.stringify(normalized), now);
      if (normalized.enabled) {
        this.db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('browser_use', ?, ?)
          ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
          .run(JSON.stringify({ enabled: false }), now);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return normalized;
  }

  getReasoningSelection(conversationId: string): ReasoningSelection {
    const row = this.db.prepare('SELECT reasoning_level AS reasoningLevel FROM conversations WHERE id = ?').get(conversationId) as Row | undefined;
    if (!row) throw new Error('Conversation not found.');
    const value = row.reasoningLevel;
    return value === 'default' || value === 'off' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' || value === 'max' ? value : 'default';
  }

  saveReasoningSelection(conversationId: string, selection: ReasoningSelection): ReasoningSelection {
    const normalized: ReasoningSelection = selection === 'off' || selection === 'low' || selection === 'medium' || selection === 'high' || selection === 'xhigh' || selection === 'max' ? selection : 'default';
    const result = this.db.prepare('UPDATE conversations SET reasoning_level = ? WHERE id = ?')
      .run(normalized, conversationId);
    if (Number(result.changes) === 0) throw new Error('Conversation not found.');
    return normalized;
  }

  close(): void {
    this.db.close();
  }
}
