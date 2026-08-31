import crypto from 'node:crypto';
import { DEFAULT_AGENT_PROFILE_ID, isAgentProfileId, type AgentProfileId } from '../../agent-profiles';
import { toConversationBackup, type ConversationBackup } from '../../conversation-backup';
import type { Conversation, ConversationProject, Message } from '../../store';
import { RepositoryBase } from './repository-base';

type Row = Record<string, unknown>;

export type ConversationRepositoryRow = Conversation;

export class ConversationRepository extends RepositoryBase {
  seedDemoData(): void {
    const count = Number((this.db.prepare('SELECT COUNT(*) AS count FROM conversations').get() as Row).count);
    if (count > 0) return;
    const now = new Date().toISOString();
    this.transaction(() => {
      const insertConversation = this.db.prepare('INSERT INTO conversations (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
      insertConversation.run('inbox', 'personal', '收件箱', now, now);
      insertConversation.run('weekly-plan', 'personal', '本周计划', now, now);
      insertConversation.run('research', 'personal', '资料整理', now, now);
      const insertMessage = this.db.prepare('INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)');
      insertMessage.run('weekly-1', 'weekly-plan', 'user', '帮我整理一下本周最重要的三件事。', now);
      insertMessage.run('weekly-2', 'weekly-plan', 'assistant', '可以。先从已经确认的事项开始：项目发布、供应商跟进和周五的复盘。', now);
      insertMessage.run('research-1', 'research', 'user', '把上次收集的资料按主题分一下。', now);
      insertMessage.run('research-2', 'research', 'assistant', '我先按“产品、技术、待确认”三个主题归类，待确认的内容单独列出。', now);
    });
  }


  listProjects(): ConversationProject[] {
    const rows = this.db.prepare('SELECT id, name, position FROM conversation_projects ORDER BY position ASC, created_at ASC').all() as Row[];
    return rows.map((row) => ({ id: String(row.id), name: String(row.name), position: Number(row.position) }));
  }

  createProject(name: string): ConversationProject {
    const normalized = name.trim();
    if (!normalized) throw new Error('Project name is required.');
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const position = Number((this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM conversation_projects').get() as Row).position);
    this.db.prepare('INSERT INTO conversation_projects (id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, normalized, position, now, now);
    return { id, name: normalized, position };
  }

  renameProject(id: string, name: string): ConversationProject {
    const normalized = name.trim();
    if (!normalized) throw new Error('Project name is required.');
    const result = this.db.prepare('UPDATE conversation_projects SET name = ?, updated_at = ? WHERE id = ?').run(normalized, new Date().toISOString(), id);
    if (Number(result.changes) === 0) throw new Error('Project not found.');
    return this.listProjects().find((project) => project.id === id)!;
  }

  deleteProject(id: string, defaultProjectId = 'personal'): void {
    if (id === defaultProjectId) throw new Error('The default project cannot be deleted.');
    this.transaction(() => {
      this.db.prepare('UPDATE conversations SET project_id = ? WHERE project_id = ?').run(defaultProjectId, id);
      const deleted = this.db.prepare('DELETE FROM conversation_projects WHERE id = ?').run(id);
      if (Number(deleted.changes) === 0) throw new Error('Project not found.');
    });
  }

  list(includeArchived = false): Conversation[] {
    const rows = this.db.prepare(`SELECT id, project_id AS projectId, title, provider_id AS providerId, profile_id AS profileId,
      updated_at AS updatedAt, archived, pinned FROM conversations ${includeArchived ? '' : 'WHERE archived = 0'}
      ORDER BY pinned DESC, updated_at DESC`).all() as Row[];
    return rows.map((row) => this.mapConversation(row));
  }

  get(id: string): Conversation | null {
    const row = this.db.prepare(`SELECT id, project_id AS projectId, title, provider_id AS providerId, profile_id AS profileId,
      updated_at AS updatedAt, archived, pinned FROM conversations WHERE id = ?`).get(id) as Row | undefined;
    return row ? this.mapConversation(row) : null;
  }

  require(id: string): Conversation {
    const conversation = this.get(id);
    if (!conversation) throw new Error('Conversation not found.');
    return conversation;
  }

  listMessages(conversationId: string): Message[] {
    const rows = this.db.prepare('SELECT id, role, content, created_at AS createdAt FROM messages WHERE conversation_id = ? ORDER BY created_at ASC').all(conversationId) as Row[];
    return rows.map((row) => ({ id: String(row.id), role: row.role as Message['role'], content: String(row.content), createdAt: String(row.createdAt) }));
  }

  exportConversation(id: string): ConversationBackup {
    return toConversationBackup(this.require(id), this.listMessages(id));
  }

  importConversation(backup: ConversationBackup): Conversation {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const providerId = backup.conversation.providerId && this.providerExists(backup.conversation.providerId)
      ? backup.conversation.providerId
      : this.defaultProviderId();
    if (!isAgentProfileId(backup.conversation.profileId)) throw new Error('Profile not found.');
    this.transaction(() => {
      this.db.prepare('INSERT INTO conversations (id, project_id, title, provider_id, profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, 'personal', backup.conversation.title, providerId, backup.conversation.profileId, now, now);
      const insert = this.db.prepare('INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)');
      for (const message of backup.messages) insert.run(crypto.randomUUID(), id, message.role, message.content, message.createdAt || now);
    });
    return this.require(id);
  }

  create(title = '新会话', projectId = 'personal', providerId?: string, profileId: AgentProfileId = DEFAULT_AGENT_PROFILE_ID): Conversation {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    if (!this.db.prepare('SELECT id FROM conversation_projects WHERE id = ?').get(projectId)) throw new Error('Project not found.');
    const selectedProviderId = providerId ?? this.defaultProviderId();
    if (selectedProviderId && !this.providerExists(selectedProviderId)) throw new Error('Provider not found.');
    if (!isAgentProfileId(profileId)) throw new Error('Profile not found.');
    this.db.prepare('INSERT INTO conversations (id, project_id, title, provider_id, profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, projectId, title, selectedProviderId, profileId, now, now);
    return { id, projectId, title, updatedAt: now, archived: false, pinned: false, profileId, ...(selectedProviderId ? { providerId: selectedProviderId } : {}) };
  }

  branch(conversationId: string, messageId: string): Conversation {
    const source = this.require(conversationId);
    const messages = this.listMessages(conversationId);
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0) throw new Error('Message not found.');
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.transaction(() => {
      this.db.prepare('INSERT INTO conversations (id, project_id, title, provider_id, profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, source.projectId, `${source.title} · 分支`, source.providerId ?? this.defaultProviderId(), source.profileId, now, now);
      const insert = this.db.prepare('INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)');
      for (const message of messages.slice(0, index + 1)) insert.run(crypto.randomUUID(), id, message.role, message.content, message.createdAt);
    });
    return this.require(id);
  }

  providerId(conversationId: string): string | null {
    const row = this.db.prepare('SELECT provider_id AS providerId FROM conversations WHERE id = ?').get(conversationId) as Row | undefined;
    if (!row) throw new Error('Conversation not found.');
    return row.providerId == null ? this.defaultProviderId() : String(row.providerId);
  }

  setProvider(conversationId: string, providerId: string): string {
    if (!this.providerExists(providerId)) throw new Error('Provider not found.');
    const result = this.db.prepare('UPDATE conversations SET provider_id = ?, updated_at = ? WHERE id = ?').run(providerId, new Date().toISOString(), conversationId);
    if (Number(result.changes) === 0) throw new Error('Conversation not found.');
    return providerId;
  }

  profileId(conversationId: string): AgentProfileId {
    const row = this.db.prepare('SELECT profile_id AS profileId FROM conversations WHERE id = ?').get(conversationId) as Row | undefined;
    if (!row) throw new Error('Conversation not found.');
    return isAgentProfileId(row.profileId) ? row.profileId : DEFAULT_AGENT_PROFILE_ID;
  }

  setProfile(conversationId: string, profileId: AgentProfileId): AgentProfileId {
    if (!isAgentProfileId(profileId)) throw new Error('Profile not found.');
    const result = this.db.prepare('UPDATE conversations SET profile_id = ?, updated_at = ? WHERE id = ?').run(profileId, new Date().toISOString(), conversationId);
    if (Number(result.changes) === 0) throw new Error('Conversation not found.');
    return profileId;
  }

  move(id: string, projectId: string): Conversation {
    const result = this.db.prepare('UPDATE conversations SET project_id = ?, updated_at = ? WHERE id = ?').run(projectId, new Date().toISOString(), id);
    if (Number(result.changes) === 0) throw new Error('Conversation not found.');
    return this.require(id);
  }

  rename(id: string, title: string): Conversation {
    const normalized = title.trim();
    if (!normalized) throw new Error('Conversation title is required.');
    const result = this.db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(normalized, new Date().toISOString(), id);
    if (Number(result.changes) === 0) throw new Error('Conversation not found.');
    return this.require(id);
  }

  setArchived(id: string, archived: boolean): Conversation {
    const result = this.db.prepare('UPDATE conversations SET archived = ?, updated_at = ? WHERE id = ?').run(archived ? 1 : 0, new Date().toISOString(), id);
    if (Number(result.changes) === 0) throw new Error('Conversation not found.');
    return this.require(id);
  }

  setPinned(id: string, pinned: boolean): Conversation {
    const result = this.db.prepare('UPDATE conversations SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);
    if (Number(result.changes) === 0) throw new Error('Conversation not found.');
    return this.require(id);
  }

  delete(id: string): void {
    this.transaction(() => {
      const result = this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
      if (Number(result.changes) === 0) throw new Error('Conversation not found.');
      this.db.prepare('DELETE FROM app_settings WHERE key = ?').run(`tool_permission:${id}`);
    });
  }

  addMessage(conversationId: string, role: Message['role'], content: string, id = crypto.randomUUID()): Message {
    const createdAt = new Date().toISOString();
    this.transaction(() => {
      this.db.prepare('INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run(id, conversationId, role, content, createdAt);
      this.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(createdAt, conversationId);
      if (role === 'user') this.setAutomaticTitle(conversationId, content, createdAt);
    });
    return { id, role, content, createdAt };
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
    this.transaction(() => {
      this.db.prepare(`DELETE FROM runs WHERE conversation_id = ? AND input_message_id IN
        (SELECT id FROM messages WHERE conversation_id = ? AND rowid >= ?)`).run(conversationId, conversationId, Number(target.rowId));
      this.db.prepare('DELETE FROM messages WHERE conversation_id = ? AND rowid > ?').run(conversationId, Number(target.rowId));
      this.db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(normalized, messageId);
      this.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), conversationId);
    });
    return { id: messageId, role: 'user', content: normalized, createdAt: String(target.createdAt) };
  }

  private setAutomaticTitle(conversationId: string, content: string, updatedAt: string): void {
    const userMessageCount = Number((this.db.prepare("SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ? AND role = 'user'").get(conversationId) as Row).count);
    if (userMessageCount !== 1) return;
    const title = Array.from(content.replace(/\s+/g, ' ').trim()).slice(0, 32).join('');
    if (!title) return;
    this.db.prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ? AND title = '新会话'").run(title, updatedAt, conversationId);
  }

  private providerExists(id: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM provider_profiles WHERE id = ?').get(id));
  }

  private defaultProviderId(): string | null {
    const row = this.db.prepare("SELECT id FROM provider_profiles ORDER BY CASE WHEN id = 'default' THEN 0 ELSE 1 END, updated_at ASC, id ASC LIMIT 1").get() as Row | undefined;
    return row ? String(row.id) : null;
  }

  private mapConversation(row: Row): Conversation {
    const profileId = isAgentProfileId(row.profileId) ? row.profileId : DEFAULT_AGENT_PROFILE_ID;
    const conversation: Conversation = {
      id: String(row.id), projectId: String(row.projectId), title: String(row.title), updatedAt: String(row.updatedAt),
      archived: Number(row.archived) === 1, pinned: Number(row.pinned) === 1, profileId,
    };
    if (row.providerId != null) conversation.providerId = String(row.providerId);
    return conversation;
  }

}
