import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_AGENT_PROFILE_ID, isAgentProfileId, type AgentProfileId } from './agent-profiles';
import { toConversationBackup, type ConversationBackup } from './conversation-backup';
import { DEFAULT_TOOL_PERMISSION_MODE, isPersistentToolPermissionMode, type PersistentToolPermissionMode } from './permission-mode';

export type ProviderConfig = {
  id: string;
  protocol: 'openai' | 'anthropic';
  baseUrl: string;
  model: string;
  displayName: string;
  contextWindow: number;
  hasApiKey: boolean;
};
export type BrowserUseConfig = { enabled: boolean };
export type ComputerUseConfig = { enabled: boolean };
export type PetFeedbackMode = 'important' | 'all' | 'hidden';
export type DesktopPetConfig = {
  enabled: boolean;
  petId?: string;
  scale?: number;
  locked?: boolean;
  opacity?: number;
  alwaysOnTop?: boolean;
  edgeSnap?: boolean;
  inertia?: boolean;
  boundaryBounce?: boolean;
  feedbackMode?: PetFeedbackMode;
  completionFeedback?: boolean;
  errorFeedback?: boolean;
  approvalFeedback?: boolean;
  soundEnabled?: boolean;
  mutedUntil?: number;
};
export type ReasoningSelection = 'default' | 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const DEFAULT_CONVERSATION_PROJECT_ID = 'personal';
export const DEFAULT_PROVIDER_ID = 'default';
export const DEFAULT_PROVIDER_CONTEXT_WINDOW = 200_000;
export const MIN_PROVIDER_CONTEXT_WINDOW = 4_096;
export const MAX_PROVIDER_CONTEXT_WINDOW = 10_000_000;
export const CURRENT_SCHEMA_VERSION = 1;
export type ConversationProject = { id: string; name: string; position: number };
export type Conversation = { id: string; projectId: string; title: string; updatedAt: string; archived: boolean; pinned: boolean; providerId?: string; profileId: AgentProfileId };
export type Message = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string };
export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type RunUsage = { inputTokens: number; outputTokens: number; totalTokens: number; contextTokens: number | null; contextWindow: number; contextPercent: number | null };
export type RunActivityStatus = 'running' | 'completed' | 'failed' | 'cancelled';
export type RunArtifact = { id: string; kind: 'browser_screenshot' | 'computer_screenshot'; mimeType: string; size: number; url: string };
export type RunActivity = { id: string; toolName: string; status: RunActivityStatus; input: string | null; output: string | null; startedAt: string; finishedAt: string | null; artifacts: RunArtifact[] };
export type RunSummary = { id: string; conversationId: string; status: RunStatus; error: string | null; startedAt: string; finishedAt: string | null; inputMessageId: string | null; usage: RunUsage | null; activities: RunActivity[] };
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
export type Note = {
  id: string;
  parentId: string | null;
  title: string;
  content: string;
  icon: string | null;
  cover: string | null;
  position: number;
  archived: boolean;
  favorite: boolean;
  lastOpenedAt: string | null;
  createdAt: string;
  updatedAt: string;
  properties: NoteProperties;
};
export type NoteProperties = { status: string | null; date: string | null; tags: string[] };
export type NoteVersion = { id: string; noteId: string; title: string; content: string; icon: string | null; cover: string | null; properties: NoteProperties; createdAt: string };
export type CreateNoteInput = { title?: string; parentId?: string | null; content?: string; icon?: string | null };
export type UpdateNoteInput = Partial<Pick<Note, 'title' | 'content' | 'archived' | 'icon' | 'cover' | 'favorite' | 'properties'>>;
export type CreateTaskInput = Pick<Task, 'title'> & Partial<Pick<Task, 'description' | 'status' | 'priority' | 'dueAt' | 'remindAt' | 'sourceConversationId'>>;
export type UpdateTaskInput = Partial<Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'dueAt' | 'remindAt'>>;
export type SearchResultKind = 'conversation' | 'message' | 'task' | 'board' | 'note';
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

export type FullBackupSnapshot = {
  conversationProjects: Array<{ id: string; name: string; position: number; createdAt: string; updatedAt: string }>;
  conversations: Array<{ id: string; projectId: string; title: string; description: string; archived: boolean; pinned: boolean; reasoningLevel: string; providerId: string | null; profileId: string; createdAt: string; updatedAt: string }>;
  messages: Array<{ id: string; conversationId: string; role: Message['role']; content: string; createdAt: string }>;
  runs: Array<{ id: string; conversationId: string; inputMessageId: string | null; status: RunStatus; error: string | null; startedAt: string; finishedAt: string | null; inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; contextTokens: number | null; contextWindow: number | null; contextPercent: number | null }>;
  runActivities: Array<{ id: string; runId: string; toolCallId: string; toolName: string; status: RunActivityStatus; input: string | null; output: string | null; startedAt: string; finishedAt: string | null }>;
  runArtifacts: Array<{ id: string; runId: string; toolCallId: string; kind: RunArtifact['kind']; mimeType: string; size: number; url: string; createdAt: string }>;
  providers: Array<{ id: string; protocol: ProviderConfig['protocol']; baseUrl: string; model: string; displayName: string; contextWindow: number; updatedAt: string }>;
  appSettings: Array<{ key: string; value: string; updatedAt: string }>;
  taskBoards: Array<{ id: string; name: string; position: number }>;
  taskTypes: Array<{ id: string; boardId: string; name: string; position: number }>;
  tasks: Array<{ id: string; boardId: string; title: string; description: string; position: number; status: string; priority: TaskPriority; dueAt: string | null; remindAt: string | null; reminderFiredAt: string | null; sourceConversationId: string | null; createdAt: string; updatedAt: string }>;
  notes?: Array<{ id: string; parentId: string | null; title: string; content: string; icon?: string | null; cover?: string | null; properties?: NoteProperties; position: number; archived: boolean; favorite?: boolean; lastOpenedAt?: string | null; createdAt: string; updatedAt: string }>;
  noteVersions?: Array<{ id: string; noteId: string; title: string; content: string; icon?: string | null; cover?: string | null; properties?: NoteProperties; createdAt: string }>;
};
export type BackupConfig = { enabled: boolean; directory: string; retention: number; lastRunAt: string | null; lastError: string | null };
export type DesktopPresenceConfig = { notificationsEnabled: boolean; menuBarEnabled: boolean };

type Row = Record<string, unknown>;

const MAX_SEARCH_QUERY_LENGTH = 120;
const MAX_SEARCH_RESULTS = 50;
const NOTE_COVER_ID_PATTERN = /^[a-z][a-z0-9-]{0,40}$/;
const NOTE_COVER_URL_PATTERN = /^yuheng-note-cover:\/\/local\/[0-9a-f-]{36}\.(?:png|jpg|webp)$/i;

function normalizeNoteCover(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cover = value.trim();
  return NOTE_COVER_ID_PATTERN.test(cover) || NOTE_COVER_URL_PATTERN.test(cover) ? cover : null;
}

const EMPTY_NOTE_PROPERTIES: NoteProperties = { status: null, date: null, tags: [] };
function normalizeNoteProperties(value: unknown): NoteProperties {
  let source: Record<string, unknown> = {};
  try { source = typeof value === 'string' ? JSON.parse(value) as Record<string, unknown> : value && typeof value === 'object' ? value as Record<string, unknown> : {}; } catch { source = {}; }
  const status = typeof source.status === 'string' ? source.status.trim().slice(0, 80) || null : null;
  const date = typeof source.date === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(source.date) ? source.date : null;
  const tags = Array.isArray(source.tags) ? [...new Set(source.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim().slice(0, 40)).filter(Boolean))].slice(0, 20) : [];
  return { status, date, tags };
}

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
      CREATE TABLE IF NOT EXISTS conversation_projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT '${DEFAULT_CONVERSATION_PROJECT_ID}' REFERENCES conversation_projects(id),
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        archived INTEGER NOT NULL DEFAULT 0,
        pinned INTEGER NOT NULL DEFAULT 0,
        reasoning_level TEXT NOT NULL DEFAULT 'default',
        provider_id TEXT,
        profile_id TEXT NOT NULL DEFAULT '${DEFAULT_AGENT_PROFILE_ID}',
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
        finished_at TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        total_tokens INTEGER,
        context_tokens INTEGER,
        context_window INTEGER,
        context_percent REAL
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
        id TEXT PRIMARY KEY,
        protocol TEXT NOT NULL CHECK (protocol IN ('openai', 'anthropic')),
        base_url TEXT NOT NULL,
        model TEXT NOT NULL,
        display_name TEXT NOT NULL,
        context_window INTEGER NOT NULL DEFAULT ${DEFAULT_PROVIDER_CONTEXT_WINDOW},
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
        position INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL REFERENCES task_types(id),
        priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
        due_at TEXT,
        remind_at TEXT,
        reminder_fired_at TEXT,
        source_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        parent_id TEXT REFERENCES notes(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        icon TEXT,
        cover TEXT,
        properties_json TEXT NOT NULL DEFAULT '{}',
        position INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        favorite INTEGER NOT NULL DEFAULT 0,
        last_opened_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS note_versions (
        id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        icon TEXT,
        cover TEXT,
        properties_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
    `);
    const providerSchema = this.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'provider_profiles'").get() as Row | undefined;
    if (typeof providerSchema?.sql === 'string' && providerSchema.sql.includes('CHECK (id = 1)')) this.migrateProviderProfiles();
    const providerColumns = this.db.prepare('PRAGMA table_info(provider_profiles)').all() as Row[];
    if (!providerColumns.some((column) => column.name === 'context_window')) this.db.exec(`ALTER TABLE provider_profiles ADD COLUMN context_window INTEGER NOT NULL DEFAULT ${DEFAULT_PROVIDER_CONTEXT_WINDOW}`);
    const runColumns = this.db.prepare('PRAGMA table_info(runs)').all() as Row[];
    if (!runColumns.some((column) => column.name === 'input_message_id')) this.db.exec('ALTER TABLE runs ADD COLUMN input_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL');
    for (const [name, sql] of [
      ['input_tokens', 'ALTER TABLE runs ADD COLUMN input_tokens INTEGER'],
      ['output_tokens', 'ALTER TABLE runs ADD COLUMN output_tokens INTEGER'],
      ['total_tokens', 'ALTER TABLE runs ADD COLUMN total_tokens INTEGER'],
      ['context_tokens', 'ALTER TABLE runs ADD COLUMN context_tokens INTEGER'],
      ['context_window', 'ALTER TABLE runs ADD COLUMN context_window INTEGER'],
      ['context_percent', 'ALTER TABLE runs ADD COLUMN context_percent REAL'],
    ] as const) if (!runColumns.some((column) => column.name === name)) this.db.exec(sql);
    const noteColumns = this.db.prepare('PRAGMA table_info(notes)').all() as Row[];
    if (!noteColumns.some((column) => column.name === 'icon')) this.db.exec('ALTER TABLE notes ADD COLUMN icon TEXT');
    if (!noteColumns.some((column) => column.name === 'cover')) this.db.exec('ALTER TABLE notes ADD COLUMN cover TEXT');
    if (!noteColumns.some((column) => column.name === 'favorite')) this.db.exec('ALTER TABLE notes ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0');
    if (!noteColumns.some((column) => column.name === 'last_opened_at')) this.db.exec('ALTER TABLE notes ADD COLUMN last_opened_at TEXT');
    if (!noteColumns.some((column) => column.name === 'properties_json')) this.db.exec("ALTER TABLE notes ADD COLUMN properties_json TEXT NOT NULL DEFAULT '{}'");
    const noteVersionColumns = this.db.prepare('PRAGMA table_info(note_versions)').all() as Row[];
    if (!noteVersionColumns.some((column) => column.name === 'properties_json')) this.db.exec("ALTER TABLE note_versions ADD COLUMN properties_json TEXT NOT NULL DEFAULT '{}'");
    this.seedConversationProject();
    const conversationColumns = this.db.prepare('PRAGMA table_info(conversations)').all() as Row[];
    if (!conversationColumns.some((column) => column.name === 'description')) this.db.exec("ALTER TABLE conversations ADD COLUMN description TEXT NOT NULL DEFAULT ''");
    if (!conversationColumns.some((column) => column.name === 'archived')) this.db.exec('ALTER TABLE conversations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
    if (!conversationColumns.some((column) => column.name === 'pinned')) this.db.exec('ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
    if (!conversationColumns.some((column) => column.name === 'reasoning_level')) this.db.exec("ALTER TABLE conversations ADD COLUMN reasoning_level TEXT NOT NULL DEFAULT 'default'");
    if (!conversationColumns.some((column) => column.name === 'provider_id')) this.db.exec('ALTER TABLE conversations ADD COLUMN provider_id TEXT');
    if (!conversationColumns.some((column) => column.name === 'profile_id')) this.db.exec(`ALTER TABLE conversations ADD COLUMN profile_id TEXT NOT NULL DEFAULT '${DEFAULT_AGENT_PROFILE_ID}'`);
    if (!conversationColumns.some((column) => column.name === 'project_id')) this.db.exec('ALTER TABLE conversations ADD COLUMN project_id TEXT REFERENCES conversation_projects(id)');
    this.db.prepare('UPDATE conversations SET project_id = ? WHERE project_id IS NULL').run(DEFAULT_CONVERSATION_PROJECT_ID);
    const migratedDefaultProviderId = this.defaultProviderId();
    if (migratedDefaultProviderId) this.db.prepare('UPDATE conversations SET provider_id = ? WHERE provider_id IS NULL').run(migratedDefaultProviderId);
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
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_project_updated ON conversations(project_id, updated_at DESC)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_run_artifacts_activity ON run_artifacts(run_id, tool_call_id, created_at ASC)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_notes_parent_position ON notes(parent_id, archived, position, id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_note_versions_note_created ON note_versions(note_id, created_at DESC)');
    this.seed();
    this.setupSearchIndex();
    // Keep a monotonic marker for future migrations without introducing a
    // separate metadata table. Existing field migrations remain idempotent.
    const schemaVersion = Number((this.db.prepare('PRAGMA user_version').get() as Row | undefined)?.user_version ?? 0);
    if (schemaVersion < CURRENT_SCHEMA_VERSION) this.db.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
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
        CREATE TRIGGER IF NOT EXISTS search_notes_insert AFTER INSERT ON notes BEGIN
          INSERT INTO search_index(kind, entity_id, parent_id, title, content, context, updated_at, archived)
          VALUES ('note', NEW.id, NEW.parent_id, NEW.title, NEW.content, '笔记', NEW.updated_at, NEW.archived);
        END;
        CREATE TRIGGER IF NOT EXISTS search_notes_update AFTER UPDATE ON notes BEGIN
          DELETE FROM search_index WHERE kind = 'note' AND entity_id = OLD.id;
          INSERT INTO search_index(kind, entity_id, parent_id, title, content, context, updated_at, archived)
          VALUES ('note', NEW.id, NEW.parent_id, NEW.title, NEW.content, '笔记', NEW.updated_at, NEW.archived);
        END;
        CREATE TRIGGER IF NOT EXISTS search_notes_delete AFTER DELETE ON notes BEGIN
          DELETE FROM search_index WHERE kind = 'note' AND entity_id = OLD.id;
        END;
      `);
      this.rebuildSearchIndex();
      this.searchIndexAvailable = true;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('no such module: fts5')) throw error;
      // A database created with FTS5 can be opened by a runtime without the
      // extension, but its triggers would still make every entity update fail.
      // Remove those triggers and keep the LIKE-based search fallback usable.
      for (const trigger of ['search_conversations_insert', 'search_conversations_update', 'search_conversations_delete', 'search_messages_insert', 'search_messages_update', 'search_messages_delete', 'search_boards_insert', 'search_boards_update', 'search_boards_delete', 'search_tasks_insert', 'search_tasks_update', 'search_tasks_delete']) {
        this.db.exec(`DROP TRIGGER IF EXISTS ${trigger}`);
      }
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
      INSERT INTO search_index(kind, entity_id, parent_id, title, content, context, updated_at, archived)
      SELECT 'note', id, parent_id, title, content, '笔记', updated_at, archived FROM notes;
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
        '会话' AS context, updated_at AS updatedAt, archived, 0 AS sortPriority
      FROM conversations
      UNION ALL
      SELECT 'task' AS kind, tasks.id, board_id AS parentId, tasks.title, tasks.description AS content,
        task_boards.name AS context, tasks.updated_at AS updatedAt, 0 AS archived, 0 AS sortPriority
      FROM tasks JOIN task_boards ON task_boards.id = tasks.board_id
      UNION ALL
      SELECT 'note' AS kind, id, parent_id AS parentId, title, content,
        '笔记' AS context, COALESCE(last_opened_at, updated_at) AS updatedAt, archived,
        CASE WHEN favorite = 1 THEN 1 ELSE 0 END AS sortPriority
      FROM notes
      ORDER BY sortPriority DESC, updatedAt DESC
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
      UNION ALL
      SELECT 'note' AS kind, id, parent_id AS parentId, title, content,
        '笔记' AS context, updated_at AS updatedAt, archived
      FROM notes WHERE title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\'
      ORDER BY updatedAt DESC
      LIMIT ?
    `).all(pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern, limit) as Row[];
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

  private migrateProviderProfiles(): void {
    const columns = this.db.prepare('PRAGMA table_info(provider_profiles)').all() as Row[];
    const hasContextWindow = columns.some((column) => column.name === 'context_window');
    this.db.exec(`
      BEGIN;
      ALTER TABLE provider_profiles RENAME TO provider_profiles_legacy;
      CREATE TABLE provider_profiles (
        id TEXT PRIMARY KEY,
        protocol TEXT NOT NULL CHECK (protocol IN ('openai', 'anthropic')),
        base_url TEXT NOT NULL,
        model TEXT NOT NULL,
        display_name TEXT NOT NULL,
        context_window INTEGER NOT NULL DEFAULT ${DEFAULT_PROVIDER_CONTEXT_WINDOW},
        updated_at TEXT NOT NULL
      );
      INSERT INTO provider_profiles (id, protocol, base_url, model, display_name, context_window, updated_at)
        SELECT '${DEFAULT_PROVIDER_ID}', protocol, base_url, model, display_name, ${hasContextWindow ? 'context_window' : DEFAULT_PROVIDER_CONTEXT_WINDOW}, updated_at FROM provider_profiles_legacy;
      DROP TABLE provider_profiles_legacy;
      COMMIT;
    `);
  }

  private seedTaskBoard(): void {
    this.db.prepare('INSERT OR IGNORE INTO task_boards (id, name, position) VALUES (?, ?, ?)').run(DEFAULT_TASK_BOARD_ID, '默认看板', 0);
  }

  private migrateTaskBoardSchema(): void {
    const typeColumns = this.db.prepare('PRAGMA table_info(task_types)').all() as Row[];
    if (!typeColumns.some((column) => column.name === 'board_id')) this.db.exec(`ALTER TABLE task_types ADD COLUMN board_id TEXT NOT NULL DEFAULT '${DEFAULT_TASK_BOARD_ID}'`);
    const taskColumns = this.db.prepare('PRAGMA table_info(tasks)').all() as Row[];
    if (!taskColumns.some((column) => column.name === 'board_id')) this.db.exec(`ALTER TABLE tasks ADD COLUMN board_id TEXT NOT NULL DEFAULT '${DEFAULT_TASK_BOARD_ID}'`);
    if (!taskColumns.some((column) => column.name === 'position')) this.db.exec('ALTER TABLE tasks ADD COLUMN position INTEGER NOT NULL DEFAULT 0');
    const groups = this.db.prepare('SELECT DISTINCT board_id AS boardId, status FROM tasks ORDER BY board_id, status').all() as Row[];
    const update = this.db.prepare('UPDATE tasks SET position = ? WHERE id = ?');
    for (const group of groups) {
      const rows = this.db.prepare('SELECT id FROM tasks WHERE board_id = ? AND status = ? ORDER BY updated_at ASC, id ASC').all(String(group.boardId), String(group.status)) as Row[];
      rows.forEach((row, index) => update.run(index, String(row.id)));
    }
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
        position INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL REFERENCES task_types(id),
        priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
        due_at TEXT,
        remind_at TEXT,
        reminder_fired_at TEXT,
        source_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO tasks (id, board_id, title, description, position, status, priority, due_at, remind_at, reminder_fired_at, source_conversation_id, created_at, updated_at)
      SELECT id, board_id, title, description, position, status, priority, due_at, remind_at, reminder_fired_at, source_conversation_id, created_at, updated_at FROM tasks_legacy;
      DROP TABLE tasks_legacy;
      COMMIT;
    `);
  }

  private seed(): void {
    const count = (this.db.prepare('SELECT COUNT(*) AS count FROM conversations').get() as Row).count;
    if (Number(count) > 0) return;
    const now = new Date().toISOString();
    const insert = this.db.prepare('INSERT INTO conversations (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    insert.run('inbox', DEFAULT_CONVERSATION_PROJECT_ID, '收件箱', now, now);
    insert.run('weekly-plan', DEFAULT_CONVERSATION_PROJECT_ID, '本周计划', now, now);
    insert.run('research', DEFAULT_CONVERSATION_PROJECT_ID, '资料整理', now, now);
    const message = this.db.prepare('INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)');
    message.run('weekly-1', 'weekly-plan', 'user', '帮我整理一下本周最重要的三件事。', now);
    message.run('weekly-2', 'weekly-plan', 'assistant', '可以。先从已经确认的事项开始：项目发布、供应商跟进和周五的复盘。', now);
    message.run('research-1', 'research', 'user', '把上次收集的资料按主题分一下。', now);
    message.run('research-2', 'research', 'assistant', '我先按“产品、技术、待确认”三个主题归类，待确认的内容单独列出。', now);
  }

  private seedConversationProject(): void {
    const now = new Date().toISOString();
    this.db.prepare('INSERT OR IGNORE INTO conversation_projects (id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(DEFAULT_CONVERSATION_PROJECT_ID, '个人事务', 0, now, now);
  }

  listConversationProjects(): ConversationProject[] {
    const rows = this.db.prepare('SELECT id, name, position FROM conversation_projects ORDER BY position ASC, created_at ASC').all() as Row[];
    return rows.map((row) => ({ id: String(row.id), name: String(row.name), position: Number(row.position) }));
  }

  createConversationProject(name: string): ConversationProject {
    const normalized = name.trim();
    if (!normalized) throw new Error('Project name is required.');
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const position = Number((this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM conversation_projects').get() as Row).position);
    this.db.prepare('INSERT INTO conversation_projects (id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, normalized, position, now, now);
    return { id, name: normalized, position };
  }

  renameConversationProject(id: string, name: string): ConversationProject {
    const normalized = name.trim();
    if (!normalized) throw new Error('Project name is required.');
    const result = this.db.prepare('UPDATE conversation_projects SET name = ?, updated_at = ? WHERE id = ?').run(normalized, new Date().toISOString(), id);
    if (Number(result.changes) === 0) throw new Error('Project not found.');
    return this.listConversationProjects().find((project) => project.id === id)!;
  }

  deleteConversationProject(id: string): void {
    if (id === DEFAULT_CONVERSATION_PROJECT_ID) throw new Error('The default project cannot be deleted.');
    this.db.exec('BEGIN');
    try {
      const result = this.db.prepare('UPDATE conversations SET project_id = ? WHERE project_id = ?').run(DEFAULT_CONVERSATION_PROJECT_ID, id);
      void result;
      const deleted = this.db.prepare('DELETE FROM conversation_projects WHERE id = ?').run(id);
      if (Number(deleted.changes) === 0) throw new Error('Project not found.');
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  listConversations(includeArchived = false): Conversation[] {
    const rows = this.db.prepare(`SELECT id, project_id AS projectId, title, provider_id AS providerId, profile_id AS profileId, updated_at AS updatedAt, archived, pinned FROM conversations ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY pinned DESC, updated_at DESC`).all() as Row[];
    return rows.map((row) => this.conversationFromRow(row));
  }

  getConversation(id: string): Conversation {
    const row = this.db.prepare('SELECT id, project_id AS projectId, title, provider_id AS providerId, profile_id AS profileId, updated_at AS updatedAt, archived, pinned FROM conversations WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new Error('Conversation not found.');
    return this.conversationFromRow(row);
  }

  private conversationFromRow(row: Row): Conversation {
    const profileId = isAgentProfileId(row.profileId) ? row.profileId : DEFAULT_AGENT_PROFILE_ID;
    const conversation: Conversation = { id: String(row.id), projectId: String(row.projectId), title: String(row.title), updatedAt: String(row.updatedAt), archived: Number(row.archived) === 1, pinned: Number(row.pinned) === 1, profileId };
    if (row.providerId != null) conversation.providerId = String(row.providerId);
    return conversation;
  }

  listMessages(conversationId: string): Message[] {
    const rows = this.db.prepare('SELECT id, role, content, created_at AS createdAt FROM messages WHERE conversation_id = ? ORDER BY created_at ASC').all(conversationId) as Row[];
    return rows.map((row) => ({ id: String(row.id), role: row.role as Message['role'], content: String(row.content), createdAt: String(row.createdAt) }));
  }

  exportConversation(id: string): ConversationBackup {
    const conversation = this.getConversation(id);
    return toConversationBackup(conversation, this.listMessages(id));
  }

  importConversation(backup: ConversationBackup): Conversation {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const providerId = backup.conversation.providerId && this.getProvider(backup.conversation.providerId)
      ? backup.conversation.providerId
      : this.defaultProviderId();
    if (!isAgentProfileId(backup.conversation.profileId)) throw new Error('Profile not found.');
    this.db.exec('BEGIN');
    try {
      this.db.prepare('INSERT INTO conversations (id, project_id, title, provider_id, profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, DEFAULT_CONVERSATION_PROJECT_ID, backup.conversation.title, providerId, backup.conversation.profileId, now, now);
      const insert = this.db.prepare('INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)');
      for (const message of backup.messages) insert.run(crypto.randomUUID(), id, message.role, message.content, message.createdAt || now);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.getConversation(id);
  }

  createConversation(title = '新会话', projectId = DEFAULT_CONVERSATION_PROJECT_ID, providerId?: string, profileId: AgentProfileId = DEFAULT_AGENT_PROFILE_ID): Conversation {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const project = this.db.prepare('SELECT id FROM conversation_projects WHERE id = ?').get(projectId);
    if (!project) throw new Error('Project not found.');
    const selectedProviderId = providerId ?? this.defaultProviderId();
    if (selectedProviderId && !this.getProvider(selectedProviderId)) throw new Error('Provider not found.');
    if (!isAgentProfileId(profileId)) throw new Error('Profile not found.');
    this.db.prepare('INSERT INTO conversations (id, project_id, title, provider_id, profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, projectId, title, selectedProviderId, profileId, now, now);
    return { id, projectId, title, updatedAt: now, archived: false, pinned: false, profileId, ...(selectedProviderId ? { providerId: selectedProviderId } : {}) };
  }

  branchConversation(conversationId: string, messageId: string): Conversation {
    const source = this.getConversation(conversationId);
    const messages = this.listMessages(conversationId);
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0) throw new Error('Message not found.');
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const title = `${source.title} · 分支`;
    this.db.exec('BEGIN');
    try {
      this.db.prepare('INSERT INTO conversations (id, project_id, title, provider_id, profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, source.projectId, title, source.providerId ?? this.defaultProviderId(), source.profileId, now, now);
      const insert = this.db.prepare('INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)');
      for (const message of messages.slice(0, index + 1)) insert.run(crypto.randomUUID(), id, message.role, message.content, message.createdAt);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.getConversation(id);
  }

  getConversationProviderId(conversationId: string): string | null {
    const row = this.db.prepare('SELECT provider_id AS providerId FROM conversations WHERE id = ?').get(conversationId) as Row | undefined;
    if (!row) throw new Error('Conversation not found.');
    return row.providerId == null ? this.defaultProviderId() : String(row.providerId);
  }

  setConversationProvider(conversationId: string, providerId: string): string {
    if (!this.getProvider(providerId)) throw new Error('Provider not found.');
    const result = this.db.prepare('UPDATE conversations SET provider_id = ?, updated_at = ? WHERE id = ?').run(providerId, new Date().toISOString(), conversationId);
    if (Number(result.changes) === 0) throw new Error('Conversation not found.');
    return providerId;
  }

  getConversationProfile(conversationId: string): AgentProfileId {
    const row = this.db.prepare('SELECT profile_id AS profileId FROM conversations WHERE id = ?').get(conversationId) as Row | undefined;
    if (!row) throw new Error('Conversation not found.');
    return isAgentProfileId(row.profileId) ? row.profileId : DEFAULT_AGENT_PROFILE_ID;
  }

  setConversationProfile(conversationId: string, profileId: AgentProfileId): AgentProfileId {
    if (!isAgentProfileId(profileId)) throw new Error('Profile not found.');
    const result = this.db.prepare('UPDATE conversations SET profile_id = ?, updated_at = ? WHERE id = ?').run(profileId, new Date().toISOString(), conversationId);
    if (Number(result.changes) === 0) throw new Error('Conversation not found.');
    return profileId;
  }

  moveConversation(id: string, projectId: string): Conversation {
    const result = this.db.prepare('UPDATE conversations SET project_id = ?, updated_at = ? WHERE id = ?').run(projectId, new Date().toISOString(), id);
    if (Number(result.changes) === 0) throw new Error('Conversation not found.');
    return this.getConversation(id);
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
    this.db.exec('BEGIN');
    try {
      const result = this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
      if (Number(result.changes) === 0) throw new Error('Conversation not found.');
      this.db.prepare('DELETE FROM app_settings WHERE key = ?').run(`tool_permission:${id}`);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
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

  replaceFromUserMessage(conversationId: string, messageId: string, content: string): Message {
    const normalized = content.trim();
    if (!normalized) throw new Error('Message content is required.');
    const target = this.db.prepare("SELECT id, rowid AS rowId, created_at AS createdAt FROM messages WHERE id = ? AND conversation_id = ? AND role = 'user'").get(messageId, conversationId) as Row | undefined;
    if (!target) throw new Error('User message not found.');
    this.db.exec('BEGIN');
    try {
      this.db.prepare(`DELETE FROM runs WHERE conversation_id = ? AND input_message_id IN
        (SELECT id FROM messages WHERE conversation_id = ? AND rowid >= ?)`).run(conversationId, conversationId, Number(target.rowId));
      this.db.prepare('DELETE FROM messages WHERE conversation_id = ? AND rowid > ?').run(conversationId, Number(target.rowId));
      this.db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(normalized, messageId);
      this.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), conversationId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { id: messageId, role: 'user', content: normalized, createdAt: String(target.createdAt) };
  }

  startRun(id: string, conversationId: string, inputMessageId: string): void {
    this.db.prepare('INSERT INTO runs (id, conversation_id, input_message_id, status, started_at) VALUES (?, ?, ?, ?, ?)').run(id, conversationId, inputMessageId, 'running', new Date().toISOString());
  }

  finishRun(id: string, status: Exclude<RunStatus, 'running'>, error?: string, usage?: RunUsage): boolean {
    const result = this.db.prepare(`UPDATE runs SET status = ?, error = ?, finished_at = ?, input_tokens = ?, output_tokens = ?, total_tokens = ?, context_tokens = ?, context_window = ?, context_percent = ? WHERE id = ? AND status = 'running'`)
      .run(status, error ?? null, new Date().toISOString(), usage?.inputTokens ?? null, usage?.outputTokens ?? null, usage?.totalTokens ?? null, usage?.contextTokens ?? null, usage?.contextWindow ?? null, usage?.contextPercent ?? null, id);
    if (Number(result.changes) === 0) return false;
    const activityStatus: RunActivityStatus = status === 'completed' ? 'completed' : status === 'cancelled' || status === 'interrupted' ? 'cancelled' : 'failed';
    this.db.prepare('UPDATE run_activities SET status = ?, finished_at = COALESCE(finished_at, ?) WHERE run_id = ? AND status = \'running\'').run(activityStatus, new Date().toISOString(), id);
    return true;
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
    const rows = this.db.prepare(`SELECT id, conversation_id AS conversationId, status, error, started_at AS startedAt, finished_at AS finishedAt, input_message_id AS inputMessageId,
      input_tokens AS inputTokens, output_tokens AS outputTokens, total_tokens AS totalTokens, context_tokens AS contextTokens, context_window AS contextWindow, context_percent AS contextPercent
      FROM runs WHERE conversation_id = ? ORDER BY started_at DESC`).all(conversationId) as Row[];
    return rows.map((row) => ({ id: String(row.id), conversationId: String(row.conversationId), status: row.status as RunStatus, error: row.error == null ? null : String(row.error), startedAt: String(row.startedAt), finishedAt: row.finishedAt == null ? null : String(row.finishedAt), inputMessageId: row.inputMessageId == null ? null : String(row.inputMessageId), usage: row.totalTokens == null ? null : { inputTokens: Number(row.inputTokens), outputTokens: Number(row.outputTokens), totalTokens: Number(row.totalTokens), contextTokens: row.contextTokens == null ? null : Number(row.contextTokens), contextWindow: Number(row.contextWindow), contextPercent: row.contextPercent == null ? null : Number(row.contextPercent) }, activities: this.listRunActivities(String(row.id)) }));
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

  private noteFromRow(row: Row): Note {
    return {
      id: String(row.id),
      parentId: row.parentId == null ? null : String(row.parentId),
      title: String(row.title),
      content: String(row.content ?? ''),
      icon: row.icon == null ? null : String(row.icon),
      cover: normalizeNoteCover(row.cover),
      position: Number(row.position ?? 0),
      archived: Number(row.archived) === 1,
      favorite: Number(row.favorite) === 1,
      lastOpenedAt: row.lastOpenedAt == null ? null : String(row.lastOpenedAt),
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
      properties: normalizeNoteProperties(row.propertiesJson),
    };
  }

  listNotes(includeArchived = false): Note[] {
    const query = includeArchived
      ? `SELECT id, parent_id AS parentId, title, content, icon, cover, properties_json AS propertiesJson, position, archived, favorite, last_opened_at AS lastOpenedAt, created_at AS createdAt, updated_at AS updatedAt FROM notes ORDER BY CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END, parent_id, position, id`
      : `WITH RECURSIVE archived_tree(id) AS (
          SELECT id FROM notes WHERE archived = 1
          UNION ALL
          SELECT notes.id FROM notes JOIN archived_tree ON notes.parent_id = archived_tree.id
        )
        SELECT id, parent_id AS parentId, title, content, icon, cover, properties_json AS propertiesJson, position, archived, favorite, last_opened_at AS lastOpenedAt, created_at AS createdAt, updated_at AS updatedAt
        FROM notes WHERE archived = 0 AND id NOT IN (SELECT id FROM archived_tree)
        ORDER BY CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END, parent_id, position, id`;
    const rows = this.db.prepare(query).all() as Row[];
    return rows.map((row) => this.noteFromRow(row));
  }

  getNote(id: string): Note | null {
    const row = this.db.prepare(`SELECT id, parent_id AS parentId, title, content, icon, cover, properties_json AS propertiesJson, position, archived, favorite, last_opened_at AS lastOpenedAt,
      created_at AS createdAt, updated_at AS updatedAt FROM notes WHERE id = ?`).get(id) as Row | undefined;
    return row ? this.noteFromRow(row) : null;
  }

  createNote(input?: CreateNoteInput | string, parentId?: string | null): Note {
    const values = typeof input === 'string'
      ? { title: input, parentId }
      : { ...(input ?? {}), ...(parentId !== undefined ? { parentId } : {}) };
    const title = typeof values.title === 'string' && values.title.trim() ? values.title.trim() : '未命名笔记';
    const content = typeof values.content === 'string' ? values.content : '';
    const icon = typeof values.icon === 'string' ? values.icon.trim().slice(0, 32) || null : null;
    const normalizedParentId = values.parentId == null ? null : String(values.parentId);
    if (normalizedParentId && !this.db.prepare('SELECT 1 FROM notes WHERE id = ?').get(normalizedParentId)) throw new Error('Parent note not found.');
    const id = crypto.randomUUID();
    const position = Number((this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM notes WHERE parent_id IS ?').get(normalizedParentId) as Row).position);
    const now = new Date().toISOString();
    this.db.prepare("INSERT INTO notes (id, parent_id, title, content, icon, cover, properties_json, position, archived, favorite, last_opened_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, '{}', ?, 0, 0, NULL, ?, ?)").run(id, normalizedParentId, title, content, icon, position, now, now);
    return this.getNote(id)!;
  }

  updateNote(id: string, patch: UpdateNoteInput): Note {
    const current = this.getNote(id);
    if (!current) throw new Error('Note not found.');
    const title = patch.title === undefined ? current.title : patch.title.trim();
    if (!title) throw new Error('Note title is required.');
    const content = patch.content === undefined ? current.content : patch.content;
    const icon = patch.icon === undefined ? current.icon : (patch.icon == null ? null : patch.icon.trim() || null);
    const cover = patch.cover === undefined ? current.cover : normalizeNoteCover(patch.cover);
    const archived = patch.archived === undefined ? current.archived : patch.archived === true;
    const favorite = patch.favorite === undefined ? current.favorite : patch.favorite === true;
    const properties = patch.properties === undefined ? current.properties : normalizeNoteProperties(patch.properties);
    const updatedAt = new Date().toISOString();
    const visibleChanged = title !== current.title || content !== current.content || icon !== current.icon || cover !== current.cover || JSON.stringify(properties) !== JSON.stringify(current.properties);
    this.db.exec('BEGIN');
    try {
      if (visibleChanged) this.recordNoteVersion(current, updatedAt);
      this.db.prepare('UPDATE notes SET title = ?, content = ?, icon = ?, cover = ?, properties_json = ?, archived = ?, favorite = ?, updated_at = ? WHERE id = ?').run(title, content, icon, cover, JSON.stringify(properties), archived ? 1 : 0, favorite ? 1 : 0, updatedAt, id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.getNote(id)!;
  }

  private recordNoteVersion(note: Pick<Note, 'id' | 'title' | 'content' | 'icon' | 'cover' | 'properties'>, createdAt = new Date().toISOString()): void {
    this.db.prepare('INSERT INTO note_versions (id, note_id, title, content, icon, cover, properties_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(crypto.randomUUID(), note.id, note.title, note.content, note.icon, note.cover, JSON.stringify(note.properties), createdAt);
    this.db.prepare(`DELETE FROM note_versions WHERE id IN (
      SELECT id FROM note_versions WHERE note_id = ? ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET 50
    )`).run(note.id);
  }

  listNoteVersions(noteId: string): NoteVersion[] {
    if (!this.getNote(noteId)) throw new Error('Note not found.');
    return (this.db.prepare(`SELECT id, note_id AS noteId, title, content, icon, cover, properties_json AS propertiesJson, created_at AS createdAt
      FROM note_versions WHERE note_id = ? ORDER BY created_at DESC, rowid DESC`).all(noteId) as Row[]).map((row) => ({
      id: String(row.id), noteId: String(row.noteId), title: String(row.title), content: String(row.content ?? ''), icon: row.icon == null ? null : String(row.icon), cover: normalizeNoteCover(row.cover), properties: normalizeNoteProperties(row.propertiesJson), createdAt: String(row.createdAt),
    }));
  }

  restoreNoteVersion(noteId: string, versionId: string): Note {
    const current = this.getNote(noteId);
    if (!current) throw new Error('Note not found.');
    const row = this.db.prepare('SELECT id, note_id AS noteId, title, content, icon, cover, properties_json AS propertiesJson FROM note_versions WHERE id = ? AND note_id = ?').get(versionId, noteId) as Row | undefined;
    if (!row) throw new Error('Note version not found.');
    const updatedAt = new Date().toISOString();
    this.db.exec('BEGIN');
    try {
      this.recordNoteVersion(current, updatedAt);
      this.db.prepare('UPDATE notes SET title = ?, content = ?, icon = ?, cover = ?, properties_json = ?, updated_at = ? WHERE id = ?').run(String(row.title), String(row.content ?? ''), row.icon == null ? null : String(row.icon), normalizeNoteCover(row.cover), JSON.stringify(normalizeNoteProperties(row.propertiesJson)), updatedAt, noteId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.getNote(noteId)!;
  }

  touchNote(id: string): Note {
    if (!this.getNote(id)) throw new Error('Note not found.');
    this.db.prepare('UPDATE notes SET last_opened_at = ? WHERE id = ?').run(new Date().toISOString(), id);
    return this.getNote(id)!;
  }

  moveNoteBlock(sourceId: string, targetId: string, sourceContent: string, blockMarkdown: string): { source: Note; target: Note } {
    if (sourceId === targetId) throw new Error('Target note must be different from source note.');
    const source = this.getNote(sourceId);
    const target = this.getNote(targetId);
    if (!source || !target) throw new Error('Note not found.');
    const block = blockMarkdown.trim();
    if (!block) throw new Error('Block content is required.');
    const targetContent = target.content.trimEnd();
    const nextTargetContent = targetContent ? `${targetContent}\n\n${block}` : block;
    const updatedAt = new Date().toISOString();
    this.db.exec('BEGIN');
    try {
      this.recordNoteVersion(source, updatedAt);
      this.recordNoteVersion(target, updatedAt);
      this.db.prepare('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?').run(sourceContent, updatedAt, sourceId);
      this.db.prepare('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?').run(nextTargetContent, updatedAt, targetId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { source: this.getNote(sourceId)!, target: this.getNote(targetId)! };
  }

  moveNote(id: string, parentId: string | null = null, targetId?: string): Note {
    const note = this.getNote(id);
    if (!note) throw new Error('Note not found.');
    if (parentId === id) throw new Error('A note cannot be moved into itself.');
    if (parentId !== null && !this.getNote(parentId)) throw new Error('Parent note not found.');
    let ancestor = parentId;
    while (ancestor) {
      if (ancestor === id) throw new Error('A note cannot be moved into its descendant.');
      const row = this.db.prepare('SELECT parent_id AS parentId FROM notes WHERE id = ?').get(ancestor) as Row | undefined;
      ancestor = row?.parentId == null ? null : String(row.parentId);
    }
    if (targetId && targetId !== id) {
      const target = this.getNote(targetId);
      if (!target || target.parentId !== parentId) throw new Error('Target note not found.');
    }

    const siblings = this.listNotes(true).filter((item) => item.parentId === parentId && item.id !== id);
    const targetIndex = targetId && targetId !== id ? siblings.findIndex((item) => item.id === targetId) : -1;
    const insertAt = targetIndex < 0 ? siblings.length : targetIndex;
    siblings.splice(insertAt, 0, note);
    this.db.exec('BEGIN');
    try {
      this.db.prepare('UPDATE notes SET parent_id = ?, updated_at = ? WHERE id = ?').run(parentId, new Date().toISOString(), id);
      const update = this.db.prepare('UPDATE notes SET position = ? WHERE id = ?');
      siblings.forEach((item, position) => update.run(position, item.id));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.getNote(id)!;
  }

  deleteNote(id: string): void {
    const note = this.getNote(id);
    if (!note) throw new Error('Note not found.');
    const result = this.db.prepare('DELETE FROM notes WHERE id = ?').run(id);
    if (Number(result.changes) === 0) throw new Error('Note not found.');
    const siblings = this.db.prepare('SELECT id FROM notes WHERE parent_id IS ? ORDER BY position ASC, id ASC').all(note.parentId) as Row[];
    const update = this.db.prepare('UPDATE notes SET position = ? WHERE id = ?');
    siblings.forEach((row, position) => update.run(position, String(row.id)));
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

  reorderTaskBoards(id: string, targetId: string): TaskBoard[] {
    const boards = this.listTaskBoards();
    const sourceIndex = boards.findIndex((board) => board.id === id);
    const targetIndex = boards.findIndex((board) => board.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) throw new Error('Task board not found.');
    if (sourceIndex === targetIndex) return boards;
    const [moved] = boards.splice(sourceIndex, 1);
    boards.splice(targetIndex, 0, moved);
    this.db.exec('BEGIN');
    try {
      const update = this.db.prepare('UPDATE task_boards SET position = ? WHERE id = ?');
      boards.forEach((board, position) => update.run(position, board.id));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.listTaskBoards();
  }

  deleteTaskBoard(id: string): void {
    if (id === DEFAULT_TASK_BOARD_ID) throw new Error('默认看板不能删除。');
    const row = this.db.prepare('SELECT position FROM task_boards WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new Error('Task board not found.');
    const position = Number(row.position);
    const result = this.db.prepare('DELETE FROM task_boards WHERE id = ?').run(id);
    if (Number(result.changes) === 0) throw new Error('Task board not found.');
    this.db.prepare('UPDATE task_boards SET position = position - 1 WHERE position > ?').run(position);
  }

  listTasks(boardId = DEFAULT_TASK_BOARD_ID): Task[] {
    const rows = this.db.prepare(`SELECT id, board_id AS boardId, title, description, status, priority, due_at AS dueAt, remind_at AS remindAt, reminder_fired_at AS reminderFiredAt,
      source_conversation_id AS sourceConversationId, created_at AS createdAt, updated_at AS updatedAt
      FROM tasks WHERE board_id = ? ORDER BY status ASC, position ASC, updated_at DESC`).all(boardId) as Row[];
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

  deleteTaskType(id: string): TaskType {
    const row = this.db.prepare('SELECT id, board_id AS boardId, name, position FROM task_types WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new Error('Task type not found.');
    const boardId = String(row.boardId);
    const typeCount = Number((this.db.prepare('SELECT COUNT(*) AS count FROM task_types WHERE board_id = ?').get(boardId) as Row).count);
    if (typeCount <= 1) throw new Error('At least one task type is required.');
    const taskCount = Number((this.db.prepare('SELECT COUNT(*) AS count FROM tasks WHERE status = ?').get(id) as Row).count);
    if (taskCount > 0) throw new Error('Task type still contains tasks. Move or delete them first.');
    this.db.prepare('DELETE FROM task_types WHERE id = ?').run(id);
    this.db.prepare('UPDATE task_types SET position = position - 1 WHERE board_id = ? AND position > ?').run(boardId, Number(row.position));
    return { id: String(row.id), boardId, name: String(row.name), position: Number(row.position) };
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
    const position = Number((this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM tasks WHERE board_id = ? AND status = ?').get(boardId, status) as Row).position);
    this.db.prepare(`INSERT INTO tasks
      (id, board_id, title, description, position, status, priority, due_at, remind_at, source_conversation_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, boardId, input.title, input.description ?? '', position, status, input.priority ?? 'medium', input.dueAt ?? null, input.remindAt ?? null, input.sourceConversationId ?? null, now, now);
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
    if (patch.status !== undefined && patch.status !== existing.status) {
      const position = Number((this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM tasks WHERE board_id = ? AND status = ?').get(existing.boardId, patch.status) as Row).position);
      assignments.push('position = ?');
      values.push(String(position));
    }
    if (assignments.length === 0) return this.getTask(id);
    if (patch.remindAt !== undefined && patch.remindAt !== existing.remindAt) assignments.push('reminder_fired_at = NULL');
    assignments.push('updated_at = ?');
    values.push(new Date().toISOString(), id);
    const result = this.db.prepare(`UPDATE tasks SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
    if (Number(result.changes) === 0) throw new Error('Task not found.');
    return this.getTask(id);
  }

  reorderTask(id: string, targetId: string): Task[] {
    const source = this.getTask(id);
    const target = this.getTask(targetId);
    if (source.boardId !== target.boardId || source.status !== target.status) throw new Error('Tasks must share a column to reorder.');
    const rows = this.db.prepare('SELECT id FROM tasks WHERE board_id = ? AND status = ? ORDER BY position ASC, updated_at DESC, id ASC').all(source.boardId, source.status) as Row[];
    const sourceIndex = rows.findIndex((row) => row.id === id);
    const targetIndex = rows.findIndex((row) => row.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return this.listTasks(source.boardId);
    const [moved] = rows.splice(sourceIndex, 1);
    rows.splice(targetIndex, 0, moved);
    this.db.exec('BEGIN');
    try {
      const update = this.db.prepare('UPDATE tasks SET position = ? WHERE id = ?');
      rows.forEach((row, position) => update.run(position, String(row.id)));
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return this.listTasks(source.boardId);
  }

  moveTaskToBoard(id: string, boardId: string): Task {
    const existing = this.getTask(id);
    if (existing.boardId === boardId) return existing;
    const board = this.db.prepare('SELECT id FROM task_boards WHERE id = ?').get(boardId);
    if (!board) throw new Error('Task board not found.');
    const targetStatus = this.db.prepare('SELECT id FROM task_types WHERE board_id = ? ORDER BY position ASC, id ASC LIMIT 1').get(boardId) as Row | undefined;
    if (!targetStatus) throw new Error('Target task board has no task types.');
    const position = Number((this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM tasks WHERE board_id = ? AND status = ?').get(boardId, String(targetStatus.id)) as Row).position);
    const result = this.db.prepare('UPDATE tasks SET board_id = ?, status = ?, position = ?, updated_at = ? WHERE id = ?')
      .run(boardId, String(targetStatus.id), position, new Date().toISOString(), id);
    if (Number(result.changes) === 0) throw new Error('Task not found.');
    return this.getTask(id);
  }

  copyTaskToBoard(id: string, boardId: string): Task {
    const existing = this.getTask(id);
    const targetStatus = this.db.prepare('SELECT id FROM task_types WHERE board_id = ? ORDER BY position ASC, id ASC LIMIT 1').get(boardId) as Row | undefined;
    if (!targetStatus) throw new Error('Target task board has no task types.');
    return this.createTask({ title: existing.title, description: existing.description, priority: existing.priority, dueAt: existing.dueAt, remindAt: existing.remindAt, status: String(targetStatus.id), sourceConversationId: existing.sourceConversationId }, boardId);
  }

  deleteTask(id: string): void {
    const result = this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    if (Number(result.changes) === 0) throw new Error('Task not found.');
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

  listProviders(): ProviderConfig[] {
    const rows = this.db.prepare("SELECT id, protocol, base_url AS baseUrl, model, display_name AS displayName, context_window AS contextWindow FROM provider_profiles ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, updated_at ASC, id ASC").all(DEFAULT_PROVIDER_ID) as Row[];
    return rows.map((row) => ({ id: String(row.id), protocol: row.protocol as ProviderConfig['protocol'], baseUrl: String(row.baseUrl), model: String(row.model), displayName: String(row.displayName), contextWindow: Number(row.contextWindow), hasApiKey: false }));
  }

  deleteProvider(id: string): void {
    if (!this.getProvider(id)) throw new Error('Provider not found.');
    const references = this.db.prepare('SELECT COUNT(*) AS count FROM conversations WHERE provider_id = ?').get(id) as Row;
    if (Number(references.count) > 0) throw new Error('Provider is still used by conversations.');
    this.db.prepare('DELETE FROM provider_profiles WHERE id = ?').run(id);
  }

  defaultProviderId(): string | null {
    const row = this.db.prepare("SELECT id FROM provider_profiles ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, updated_at ASC, id ASC LIMIT 1").get(DEFAULT_PROVIDER_ID) as Row | undefined;
    return row ? String(row.id) : null;
  }

  getProvider(id?: string): ProviderConfig | null {
    const providerId = id ?? this.defaultProviderId();
    if (!providerId) return null;
    const row = this.db.prepare('SELECT id, protocol, base_url AS baseUrl, model, display_name AS displayName, context_window AS contextWindow FROM provider_profiles WHERE id = ?').get(providerId) as Row | undefined;
    if (!row) return null;
    return { id: String(row.id), protocol: row.protocol as ProviderConfig['protocol'], baseUrl: String(row.baseUrl), model: String(row.model), displayName: String(row.displayName), contextWindow: Number(row.contextWindow), hasApiKey: false };
  }

  saveProvider(config: Omit<ProviderConfig, 'hasApiKey' | 'id'> & { id?: string }): ProviderConfig {
    const existingCount = Number((this.db.prepare('SELECT COUNT(*) AS count FROM provider_profiles').get() as Row).count);
    const id = config.id?.trim() || (existingCount === 0 ? DEFAULT_PROVIDER_ID : crypto.randomUUID());
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO provider_profiles (id, protocol, base_url, model, display_name, context_window, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET protocol=excluded.protocol, base_url=excluded.base_url, model=excluded.model, display_name=excluded.display_name, context_window=excluded.context_window, updated_at=excluded.updated_at`).run(id, config.protocol, config.baseUrl, config.model, config.displayName, config.contextWindow, now);
    if (existingCount === 0) this.db.prepare('UPDATE conversations SET provider_id = ? WHERE provider_id IS NULL').run(id);
    return { ...config, id, hasApiKey: true };
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

  getDesktopPetConfig(): DesktopPetConfig {
    const row = this.db.prepare("SELECT value FROM app_settings WHERE key = 'desktop_pet'").get() as Row | undefined;
    if (!row) return { enabled: false };
    try {
      const value = JSON.parse(String(row.value)) as Record<string, unknown>;
      const petId = typeof value.petId === 'string' && value.petId.trim() ? value.petId.trim() : undefined;
      const scale = typeof value.scale === 'number' && Number.isFinite(value.scale) ? Math.min(1.4, Math.max(0.8, value.scale)) : undefined;
      const opacity = typeof value.opacity === 'number' && Number.isFinite(value.opacity) ? Math.min(1, Math.max(0.2, value.opacity)) : undefined;
      const locked = typeof value.locked === 'boolean' ? value.locked : undefined;
      const alwaysOnTop = typeof value.alwaysOnTop === 'boolean' ? value.alwaysOnTop : undefined;
      const edgeSnap = typeof value.edgeSnap === 'boolean' ? value.edgeSnap : undefined;
      const inertia = typeof value.inertia === 'boolean' ? value.inertia : undefined;
      const boundaryBounce = typeof value.boundaryBounce === 'boolean' ? value.boundaryBounce : undefined;
      const feedbackMode = value.feedbackMode === 'important' || value.feedbackMode === 'all' || value.feedbackMode === 'hidden' ? value.feedbackMode : undefined;
      const completionFeedback = typeof value.completionFeedback === 'boolean' ? value.completionFeedback : undefined;
      const errorFeedback = typeof value.errorFeedback === 'boolean' ? value.errorFeedback : undefined;
      const approvalFeedback = typeof value.approvalFeedback === 'boolean' ? value.approvalFeedback : undefined;
      const soundEnabled = typeof value.soundEnabled === 'boolean' ? value.soundEnabled : undefined;
      const mutedUntil = typeof value.mutedUntil === 'number' && Number.isFinite(value.mutedUntil) && value.mutedUntil > 0 ? value.mutedUntil : undefined;
      return { enabled: value.enabled === true, ...(petId ? { petId } : {}), ...(scale !== undefined ? { scale } : {}), ...(locked !== undefined ? { locked } : {}), ...(opacity !== undefined ? { opacity } : {}), ...(alwaysOnTop !== undefined ? { alwaysOnTop } : {}), ...(edgeSnap !== undefined ? { edgeSnap } : {}), ...(inertia !== undefined ? { inertia } : {}), ...(boundaryBounce !== undefined ? { boundaryBounce } : {}), ...(feedbackMode ? { feedbackMode } : {}), ...(completionFeedback !== undefined ? { completionFeedback } : {}), ...(errorFeedback !== undefined ? { errorFeedback } : {}), ...(approvalFeedback !== undefined ? { approvalFeedback } : {}), ...(soundEnabled !== undefined ? { soundEnabled } : {}), ...(mutedUntil !== undefined ? { mutedUntil } : {}) };
    } catch {
      return { enabled: false };
    }
  }

  saveDesktopPetConfig(config: DesktopPetConfig): DesktopPetConfig {
    const petId = typeof config.petId === 'string' && config.petId.trim() ? config.petId.trim() : undefined;
    const scale = typeof config.scale === 'number' && Number.isFinite(config.scale) ? Math.min(1.4, Math.max(0.8, config.scale)) : undefined;
    const opacity = typeof config.opacity === 'number' && Number.isFinite(config.opacity) ? Math.min(1, Math.max(0.2, config.opacity)) : undefined;
    const locked = typeof config.locked === 'boolean' ? config.locked : undefined;
    const alwaysOnTop = typeof config.alwaysOnTop === 'boolean' ? config.alwaysOnTop : undefined;
    const edgeSnap = typeof config.edgeSnap === 'boolean' ? config.edgeSnap : undefined;
    const inertia = typeof config.inertia === 'boolean' ? config.inertia : undefined;
    const boundaryBounce = typeof config.boundaryBounce === 'boolean' ? config.boundaryBounce : undefined;
    const feedbackMode = config.feedbackMode === 'important' || config.feedbackMode === 'all' || config.feedbackMode === 'hidden' ? config.feedbackMode : undefined;
    const completionFeedback = typeof config.completionFeedback === 'boolean' ? config.completionFeedback : undefined;
    const errorFeedback = typeof config.errorFeedback === 'boolean' ? config.errorFeedback : undefined;
    const approvalFeedback = typeof config.approvalFeedback === 'boolean' ? config.approvalFeedback : undefined;
    const soundEnabled = typeof config.soundEnabled === 'boolean' ? config.soundEnabled : undefined;
    const mutedUntil = typeof config.mutedUntil === 'number' && Number.isFinite(config.mutedUntil) && config.mutedUntil > 0 ? config.mutedUntil : undefined;
    const value = { enabled: config.enabled === true, ...(petId ? { petId } : {}), ...(scale !== undefined ? { scale } : {}), ...(locked !== undefined ? { locked } : {}), ...(opacity !== undefined ? { opacity } : {}), ...(alwaysOnTop !== undefined ? { alwaysOnTop } : {}), ...(edgeSnap !== undefined ? { edgeSnap } : {}), ...(inertia !== undefined ? { inertia } : {}), ...(boundaryBounce !== undefined ? { boundaryBounce } : {}), ...(feedbackMode ? { feedbackMode } : {}), ...(completionFeedback !== undefined ? { completionFeedback } : {}), ...(errorFeedback !== undefined ? { errorFeedback } : {}), ...(approvalFeedback !== undefined ? { approvalFeedback } : {}), ...(soundEnabled !== undefined ? { soundEnabled } : {}), ...(mutedUntil !== undefined ? { mutedUntil } : {}) } satisfies DesktopPetConfig;
    this.db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('desktop_pet', ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(JSON.stringify(value), new Date().toISOString());
    return value;
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

  getToolPermissionMode(conversationId: string): PersistentToolPermissionMode {
    this.getConversation(conversationId);
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(`tool_permission:${conversationId}`) as Row | undefined;
    if (!row) return DEFAULT_TOOL_PERMISSION_MODE;
    try {
      const value: unknown = JSON.parse(String(row.value));
      return isPersistentToolPermissionMode(value) ? value : DEFAULT_TOOL_PERMISSION_MODE;
    } catch {
      return DEFAULT_TOOL_PERMISSION_MODE;
    }
  }

  saveToolPermissionMode(conversationId: string, mode: PersistentToolPermissionMode): PersistentToolPermissionMode {
    this.getConversation(conversationId);
    if (!isPersistentToolPermissionMode(mode)) throw new Error('Only persistent permission modes can be stored.');
    this.db.prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at')
      .run(`tool_permission:${conversationId}`, JSON.stringify(mode), new Date().toISOString());
    return mode;
  }

  getBackupConfig(defaultDirectory: string): BackupConfig {
    const fallback: BackupConfig = { enabled: false, directory: defaultDirectory, retention: 7, lastRunAt: null, lastError: null };
    const row = this.db.prepare("SELECT value FROM app_settings WHERE key = 'backup_config'").get() as Row | undefined;
    if (!row) return fallback;
    try {
      const value = JSON.parse(String(row.value)) as Partial<BackupConfig>;
      return { enabled: value.enabled === true, directory: typeof value.directory === 'string' && value.directory ? value.directory : defaultDirectory, retention: Math.min(30, Math.max(1, Number(value.retention) || 7)), lastRunAt: typeof value.lastRunAt === 'string' ? value.lastRunAt : null, lastError: typeof value.lastError === 'string' ? value.lastError : null };
    } catch { return fallback; }
  }

  saveBackupConfig(config: Pick<BackupConfig, 'enabled' | 'directory' | 'retention'> & Partial<Pick<BackupConfig, 'lastRunAt' | 'lastError'>>): BackupConfig {
    const value: BackupConfig = { enabled: config.enabled === true, directory: config.directory.trim(), retention: Math.min(30, Math.max(1, Math.round(config.retention))), lastRunAt: config.lastRunAt ?? null, lastError: config.lastError ?? null };
    this.db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('backup_config', ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(JSON.stringify(value), new Date().toISOString());
    return value;
  }

  getDesktopPresenceConfig(): DesktopPresenceConfig {
    const fallback: DesktopPresenceConfig = { notificationsEnabled: true, menuBarEnabled: true };
    const row = this.db.prepare("SELECT value FROM app_settings WHERE key = 'desktop_presence'").get() as Row | undefined;
    if (!row) return fallback;
    try {
      const value = JSON.parse(String(row.value)) as Partial<DesktopPresenceConfig>;
      return { notificationsEnabled: value.notificationsEnabled !== false, menuBarEnabled: value.menuBarEnabled !== false };
    } catch { return fallback; }
  }

  saveDesktopPresenceConfig(config: Partial<DesktopPresenceConfig>): DesktopPresenceConfig {
    const current = this.getDesktopPresenceConfig();
    const value = { notificationsEnabled: config.notificationsEnabled ?? current.notificationsEnabled, menuBarEnabled: config.menuBarEnabled ?? current.menuBarEnabled };
    this.db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('desktop_presence', ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(JSON.stringify(value), new Date().toISOString());
    return value;
  }

  exportFullBackupSnapshot(): FullBackupSnapshot {
    const mapRows = (sql: string): Row[] => this.db.prepare(sql).all() as Row[];
    return {
      conversationProjects: mapRows('SELECT id, name, position, created_at AS createdAt, updated_at AS updatedAt FROM conversation_projects').map((r) => ({ id: String(r.id), name: String(r.name), position: Number(r.position), createdAt: String(r.createdAt), updatedAt: String(r.updatedAt) })),
      conversations: mapRows('SELECT id, project_id AS projectId, title, description, archived, pinned, reasoning_level AS reasoningLevel, provider_id AS providerId, profile_id AS profileId, created_at AS createdAt, updated_at AS updatedAt FROM conversations').map((r) => ({ id: String(r.id), projectId: String(r.projectId), title: String(r.title), description: String(r.description ?? ''), archived: Number(r.archived) === 1, pinned: Number(r.pinned) === 1, reasoningLevel: String(r.reasoningLevel ?? 'default'), providerId: r.providerId == null ? null : String(r.providerId), profileId: String(r.profileId), createdAt: String(r.createdAt), updatedAt: String(r.updatedAt) })),
      messages: mapRows('SELECT id, conversation_id AS conversationId, role, content, created_at AS createdAt FROM messages').map((r) => ({ id: String(r.id), conversationId: String(r.conversationId), role: r.role as Message['role'], content: String(r.content), createdAt: String(r.createdAt) })),
      runs: mapRows('SELECT id, conversation_id AS conversationId, input_message_id AS inputMessageId, status, error, started_at AS startedAt, finished_at AS finishedAt, input_tokens AS inputTokens, output_tokens AS outputTokens, total_tokens AS totalTokens, context_tokens AS contextTokens, context_window AS contextWindow, context_percent AS contextPercent FROM runs').map((r) => ({ id: String(r.id), conversationId: String(r.conversationId), inputMessageId: r.inputMessageId == null ? null : String(r.inputMessageId), status: r.status as RunStatus, error: r.error == null ? null : String(r.error), startedAt: String(r.startedAt), finishedAt: r.finishedAt == null ? null : String(r.finishedAt), inputTokens: r.inputTokens == null ? null : Number(r.inputTokens), outputTokens: r.outputTokens == null ? null : Number(r.outputTokens), totalTokens: r.totalTokens == null ? null : Number(r.totalTokens), contextTokens: r.contextTokens == null ? null : Number(r.contextTokens), contextWindow: r.contextWindow == null ? null : Number(r.contextWindow), contextPercent: r.contextPercent == null ? null : Number(r.contextPercent) })),
      runActivities: mapRows('SELECT id, run_id AS runId, tool_call_id AS toolCallId, tool_name AS toolName, status, input, output, started_at AS startedAt, finished_at AS finishedAt FROM run_activities').map((r) => ({ id: String(r.id), runId: String(r.runId), toolCallId: String(r.toolCallId), toolName: String(r.toolName), status: r.status as RunActivityStatus, input: r.input == null ? null : String(r.input), output: r.output == null ? null : String(r.output), startedAt: String(r.startedAt), finishedAt: r.finishedAt == null ? null : String(r.finishedAt) })),
      runArtifacts: mapRows('SELECT id, run_id AS runId, tool_call_id AS toolCallId, kind, mime_type AS mimeType, size, url, created_at AS createdAt FROM run_artifacts').map((r) => ({ id: String(r.id), runId: String(r.runId), toolCallId: String(r.toolCallId), kind: r.kind as RunArtifact['kind'], mimeType: String(r.mimeType), size: Number(r.size), url: String(r.url), createdAt: String(r.createdAt) })),
      providers: mapRows('SELECT id, protocol, base_url AS baseUrl, model, display_name AS displayName, context_window AS contextWindow, updated_at AS updatedAt FROM provider_profiles').map((r) => ({ id: String(r.id), protocol: r.protocol as ProviderConfig['protocol'], baseUrl: String(r.baseUrl), model: String(r.model), displayName: String(r.displayName), contextWindow: Number(r.contextWindow), updatedAt: String(r.updatedAt) })),
      appSettings: mapRows("SELECT key, value, updated_at AS updatedAt FROM app_settings WHERE key IN ('browser_use', 'computer_use', 'desktop_presence', 'desktop_pet')").map((r) => ({ key: String(r.key), value: String(r.value), updatedAt: String(r.updatedAt) })),
      taskBoards: mapRows('SELECT id, name, position FROM task_boards').map((r) => ({ id: String(r.id), name: String(r.name), position: Number(r.position) })),
      taskTypes: mapRows('SELECT id, board_id AS boardId, name, position FROM task_types').map((r) => ({ id: String(r.id), boardId: String(r.boardId), name: String(r.name), position: Number(r.position) })),
      tasks: mapRows('SELECT id, board_id AS boardId, title, description, position, status, priority, due_at AS dueAt, remind_at AS remindAt, reminder_fired_at AS reminderFiredAt, source_conversation_id AS sourceConversationId, created_at AS createdAt, updated_at AS updatedAt FROM tasks').map((r) => ({ id: String(r.id), boardId: String(r.boardId), title: String(r.title), description: String(r.description ?? ''), position: Number(r.position ?? 0), status: String(r.status), priority: r.priority as TaskPriority, dueAt: r.dueAt == null ? null : String(r.dueAt), remindAt: r.remindAt == null ? null : String(r.remindAt), reminderFiredAt: r.reminderFiredAt == null ? null : String(r.reminderFiredAt), sourceConversationId: r.sourceConversationId == null ? null : String(r.sourceConversationId), createdAt: String(r.createdAt), updatedAt: String(r.updatedAt) })),
      notes: mapRows('SELECT id, parent_id AS parentId, title, content, icon, cover, properties_json AS propertiesJson, position, archived, favorite, last_opened_at AS lastOpenedAt, created_at AS createdAt, updated_at AS updatedAt FROM notes ORDER BY CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END, parent_id, position, id').map((r) => ({ id: String(r.id), parentId: r.parentId == null ? null : String(r.parentId), title: String(r.title), content: String(r.content ?? ''), icon: r.icon == null ? null : String(r.icon), cover: normalizeNoteCover(r.cover), properties: normalizeNoteProperties(r.propertiesJson), position: Number(r.position ?? 0), archived: Number(r.archived) === 1, favorite: Number(r.favorite) === 1, lastOpenedAt: r.lastOpenedAt == null ? null : String(r.lastOpenedAt), createdAt: String(r.createdAt), updatedAt: String(r.updatedAt) })),
      noteVersions: mapRows('SELECT id, note_id AS noteId, title, content, icon, cover, properties_json AS propertiesJson, created_at AS createdAt FROM note_versions ORDER BY created_at, rowid').map((r) => ({ id: String(r.id), noteId: String(r.noteId), title: String(r.title), content: String(r.content ?? ''), icon: r.icon == null ? null : String(r.icon), cover: normalizeNoteCover(r.cover), properties: normalizeNoteProperties(r.propertiesJson), createdAt: String(r.createdAt) })),
    };
  }

  importFullBackupSnapshot(snapshot: FullBackupSnapshot): { conversations: number; messages: number; tasks: number; notes: number; missingProviders: number; conversationMap: Record<string, string> } {
    const projectMap = new Map<string, string>();
    const boardMap = new Map<string, string>();
    const typeMap = new Map<string, string>();
    const conversationMap = new Map<string, string>();
    const messageMap = new Map<string, string>();
    const runMap = new Map<string, string>();
    let importedTasks = 0;
    let importedNotes = 0;
    const noteMap = new Map<string, string>();
    const providerIds = new Set(this.listProviders().map((p) => p.id));
    const defaultProvider = this.defaultProviderId();
    const now = new Date().toISOString();
    this.db.exec('BEGIN');
    try {
      const insertProject = this.db.prepare('INSERT INTO conversation_projects (id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
      for (const item of snapshot.conversationProjects) { const id = crypto.randomUUID(); projectMap.set(item.id, id); insertProject.run(id, item.name, item.position, item.createdAt || now, item.updatedAt || now); }
      if (!projectMap.has(DEFAULT_CONVERSATION_PROJECT_ID)) projectMap.set(DEFAULT_CONVERSATION_PROJECT_ID, DEFAULT_CONVERSATION_PROJECT_ID);
      const insertConversation = this.db.prepare('INSERT INTO conversations (id, project_id, title, description, archived, pinned, reasoning_level, provider_id, profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const item of snapshot.conversations) { const id = crypto.randomUUID(); conversationMap.set(item.id, id); const providerId = item.providerId && providerIds.has(item.providerId) ? item.providerId : defaultProvider; const profileId = isAgentProfileId(item.profileId) ? item.profileId : DEFAULT_AGENT_PROFILE_ID; insertConversation.run(id, projectMap.get(item.projectId) ?? DEFAULT_CONVERSATION_PROJECT_ID, item.title, item.description, item.archived ? 1 : 0, item.pinned ? 1 : 0, item.reasoningLevel, providerId, profileId, item.createdAt || now, item.updatedAt || now); }
      const insertMessage = this.db.prepare('INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)');
      for (const item of snapshot.messages) { const id = crypto.randomUUID(); const conversationId = conversationMap.get(item.conversationId); if (!conversationId) continue; messageMap.set(item.id, id); insertMessage.run(id, conversationId, item.role === 'assistant' ? 'assistant' : 'user', item.content, item.createdAt || now); }
      const insertRun = this.db.prepare('INSERT INTO runs (id, conversation_id, input_message_id, status, error, started_at, finished_at, input_tokens, output_tokens, total_tokens, context_tokens, context_window, context_percent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const item of snapshot.runs) { const id = crypto.randomUUID(); const conversationId = conversationMap.get(item.conversationId); if (!conversationId) continue; runMap.set(item.id, id); const status = item.status === 'completed' || item.status === 'failed' || item.status === 'cancelled' || item.status === 'interrupted' ? item.status : 'interrupted'; insertRun.run(id, conversationId, item.inputMessageId ? messageMap.get(item.inputMessageId) ?? null : null, status, item.error, item.startedAt || now, item.finishedAt || now, item.inputTokens, item.outputTokens, item.totalTokens, item.contextTokens, item.contextWindow, item.contextPercent); }
      const insertActivity = this.db.prepare('INSERT INTO run_activities (id, run_id, tool_call_id, tool_name, status, input, output, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const item of snapshot.runActivities) { const runId = runMap.get(item.runId); if (!runId) continue; insertActivity.run(crypto.randomUUID(), runId, item.toolCallId, item.toolName, item.status === 'running' ? 'cancelled' : item.status, item.input, item.output, item.startedAt || now, item.finishedAt || now); }
      const insertArtifact = this.db.prepare('INSERT INTO run_artifacts (id, run_id, tool_call_id, kind, mime_type, size, url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const item of snapshot.runArtifacts) { const runId = runMap.get(item.runId); if (runId) insertArtifact.run(crypto.randomUUID(), runId, item.toolCallId, item.kind, item.mimeType, item.size, item.url, item.createdAt || now); }
      for (const item of snapshot.taskBoards) { const id = crypto.randomUUID(); boardMap.set(item.id, id); this.db.prepare('INSERT INTO task_boards (id, name, position) VALUES (?, ?, ?)').run(id, item.name, item.position); }
      for (const item of snapshot.taskTypes) { const boardId = boardMap.get(item.boardId); if (!boardId) continue; const id = crypto.randomUUID(); typeMap.set(item.id, id); this.db.prepare('INSERT INTO task_types (id, board_id, name, position) VALUES (?, ?, ?, ?)').run(id, boardId, item.name, item.position); }
      for (const item of snapshot.tasks) { const boardId = boardMap.get(item.boardId); const status = typeMap.get(item.status); if (!boardId || !status) continue; this.db.prepare('INSERT INTO tasks (id, board_id, title, description, position, status, priority, due_at, remind_at, reminder_fired_at, source_conversation_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(crypto.randomUUID(), boardId, item.title, item.description, item.position, status, item.priority, item.dueAt, item.remindAt, item.reminderFiredAt, item.sourceConversationId ? conversationMap.get(item.sourceConversationId) ?? null : null, item.createdAt || now, item.updatedAt || now); importedTasks += 1; }
      const pendingNotes = [...(snapshot.notes ?? [])];
      const insertNote = this.db.prepare('INSERT INTO notes (id, parent_id, title, content, icon, cover, properties_json, position, archived, favorite, last_opened_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      while (pendingNotes.length) {
        let progressed = false;
        for (let index = pendingNotes.length - 1; index >= 0; index -= 1) {
          const item = pendingNotes[index];
          const mappedParentId = item.parentId == null ? null : noteMap.get(item.parentId);
          if (item.parentId != null && !mappedParentId) continue;
          const parentId = mappedParentId ?? null;
          const id = crypto.randomUUID();
          noteMap.set(item.id, id);
          insertNote.run(id, parentId, item.title, item.content, typeof item.icon === 'string' ? item.icon.trim().slice(0, 32) || null : null, normalizeNoteCover(item.cover), JSON.stringify(normalizeNoteProperties(item.properties ?? EMPTY_NOTE_PROPERTIES)), item.position, item.archived ? 1 : 0, item.favorite ? 1 : 0, typeof item.lastOpenedAt === 'string' ? item.lastOpenedAt : null, item.createdAt || now, item.updatedAt || now);
          pendingNotes.splice(index, 1);
          importedNotes += 1;
          progressed = true;
        }
        if (!progressed) break;
      }
      // Notes receive fresh identities on import; rewrite only links that point
      // to notes in this same snapshot, leaving external/unknown links intact.
      const importedNoteLink = /yuheng-note:\/\/([^\s)]+)/gu;
      for (const [, mappedId] of noteMap) {
        const imported = this.getNote(mappedId);
        if (!imported) continue;
        const content = imported.content.replace(importedNoteLink, (url, encodedId: string) => {
          let sourceId: string;
          try { sourceId = decodeURIComponent(encodedId); } catch { return url; }
          const replacement = noteMap.get(sourceId);
          return replacement ? `yuheng-note://${encodeURIComponent(replacement)}` : url;
        });
        if (content !== imported.content) this.db.prepare('UPDATE notes SET content = ? WHERE id = ?').run(content, mappedId);
      }
      const versionsByNote = new Map<string, NonNullable<FullBackupSnapshot['noteVersions']>>();
      for (const version of snapshot.noteVersions ?? []) {
        if (!noteMap.has(version.noteId)) continue;
        const versions = versionsByNote.get(version.noteId) ?? [];
        versions.push(version);
        versionsByNote.set(version.noteId, versions);
      }
      const insertVersion = this.db.prepare('INSERT INTO note_versions (id, note_id, title, content, icon, cover, properties_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const [sourceNoteId, versions] of versionsByNote) {
        const noteId = noteMap.get(sourceNoteId)!;
        for (const version of versions.slice(-50)) {
          const content = version.content.replace(importedNoteLink, (url, encodedId: string) => {
            let linkedSourceId: string;
            try { linkedSourceId = decodeURIComponent(encodedId); } catch { return url; }
            const replacement = noteMap.get(linkedSourceId);
            return replacement ? `yuheng-note://${encodeURIComponent(replacement)}` : url;
          });
          insertVersion.run(crypto.randomUUID(), noteId, version.title, content, typeof version.icon === 'string' ? version.icon.trim().slice(0, 32) || null : null, normalizeNoteCover(version.cover), JSON.stringify(normalizeNoteProperties(version.properties ?? EMPTY_NOTE_PROPERTIES)), version.createdAt || now);
        }
      }
      const insertSetting = this.db.prepare("INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)");
      // Automatic backup is an opt-in local policy and is never enabled by an import.
      for (const item of snapshot.appSettings) if (item.key === 'browser_use' || item.key === 'computer_use' || item.key === 'desktop_presence' || item.key === 'desktop_pet') insertSetting.run(item.key, item.value, item.updatedAt || now);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return { conversations: conversationMap.size, messages: messageMap.size, tasks: importedTasks, notes: importedNotes, missingProviders: snapshot.providers.filter((p) => !providerIds.has(p.id)).length, conversationMap: Object.fromEntries(conversationMap) };
  }

  close(): void {
    this.db.close();
  }
}
