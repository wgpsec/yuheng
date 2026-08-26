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

export type Conversation = { id: string; title: string; updatedAt: string };
export type Message = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string };
export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type RunSummary = { id: string; conversationId: string; status: RunStatus; error: string | null; startedAt: string; finishedAt: string | null; inputMessageId: string | null };

type Row = Record<string, unknown>;

export class AppStore {
  private readonly db: DatabaseSync;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, 'yuheng.sqlite'));
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
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
      CREATE TABLE IF NOT EXISTS provider_profiles (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        protocol TEXT NOT NULL CHECK (protocol IN ('openai', 'anthropic')),
        base_url TEXT NOT NULL,
        model TEXT NOT NULL,
        display_name TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const runColumns = this.db.prepare('PRAGMA table_info(runs)').all() as Row[];
    if (!runColumns.some((column) => column.name === 'input_message_id')) this.db.exec('ALTER TABLE runs ADD COLUMN input_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL');
    this.seed();
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

  listConversations(): Conversation[] {
    const rows = this.db.prepare('SELECT id, title, updated_at AS updatedAt FROM conversations ORDER BY updated_at DESC').all() as Row[];
    return rows.map((row) => ({ id: String(row.id), title: String(row.title), updatedAt: String(row.updatedAt) }));
  }

  listMessages(conversationId: string): Message[] {
    const rows = this.db.prepare('SELECT id, role, content, created_at AS createdAt FROM messages WHERE conversation_id = ? ORDER BY created_at ASC').all(conversationId) as Row[];
    return rows.map((row) => ({ id: String(row.id), role: row.role as Message['role'], content: String(row.content), createdAt: String(row.createdAt) }));
  }

  createConversation(title = '新会话'): Conversation {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.prepare('INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, title, now, now);
    return { id, title, updatedAt: now };
  }

  addMessage(conversationId: string, role: Message['role'], content: string, id = crypto.randomUUID()): Message {
    const createdAt = new Date().toISOString();
    this.db.prepare('INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run(id, conversationId, role, content, createdAt);
    this.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(createdAt, conversationId);
    return { id, role, content, createdAt };
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
  }

  recoverRunningRuns(): number {
    const result = this.db.prepare("UPDATE runs SET status = 'interrupted', error = ?, finished_at = ? WHERE status = 'running'").run('应用重启时运行被中断。', new Date().toISOString());
    return Number(result.changes);
  }

  listRuns(conversationId: string): RunSummary[] {
    const rows = this.db.prepare('SELECT id, conversation_id AS conversationId, status, error, started_at AS startedAt, finished_at AS finishedAt, input_message_id AS inputMessageId FROM runs WHERE conversation_id = ? ORDER BY started_at DESC').all(conversationId) as Row[];
    return rows.map((row) => ({ id: String(row.id), conversationId: String(row.conversationId), status: row.status as RunStatus, error: row.error == null ? null : String(row.error), startedAt: String(row.startedAt), finishedAt: row.finishedAt == null ? null : String(row.finishedAt), inputMessageId: row.inputMessageId == null ? null : String(row.inputMessageId) }));
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

  close(): void {
    this.db.close();
  }
}
