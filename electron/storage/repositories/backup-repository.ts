import crypto from 'node:crypto';
import { isAgentProfileId, DEFAULT_AGENT_PROFILE_ID } from '../../agent-profiles';
import type { FullBackupSnapshot, ProviderConfig, RunActivityStatus, RunArtifact, RunStatus, TaskPriority } from '../../store';
import { normalizeNoteCover, normalizeNoteProperties } from './note-repository';
import type { DatabaseConnection } from '../database';
import { RepositoryBase } from './repository-base';

type Row = Record<string, unknown>;

export type BackupImportReport = {
  conversations: number;
  messages: number;
  tasks: number;
  notes: number;
  missingProviders: number;
  conversationMap: Record<string, string>;
};

export class BackupRepository extends RepositoryBase {

  snapshot<T>(read: (db: DatabaseConnection) => T): T {
    return this.transaction(() => read(this.db));
  }

  export(): FullBackupSnapshot {
    return this.snapshot(() => this.exportSnapshot());
  }

  private exportSnapshot(): FullBackupSnapshot {
    const rows = (sql: string): Row[] => this.db.prepare(sql).all() as Row[];
    return {
      conversationProjects: rows('SELECT id, name, position, workspace_path AS workspacePath, created_at AS createdAt, updated_at AS updatedAt FROM conversation_projects').map((r) => ({ id: String(r.id), name: String(r.name), position: Number(r.position), workspacePath: r.workspacePath == null ? null : String(r.workspacePath), createdAt: String(r.createdAt), updatedAt: String(r.updatedAt) })),
      conversations: rows('SELECT id, project_id AS projectId, title, description, archived, pinned, reasoning_level AS reasoningLevel, provider_id AS providerId, profile_id AS profileId, workspace_path AS workspacePath, created_at AS createdAt, updated_at AS updatedAt FROM conversations').map((r) => ({ id: String(r.id), projectId: String(r.projectId), title: String(r.title), description: String(r.description ?? ''), archived: Number(r.archived) === 1, pinned: Number(r.pinned) === 1, reasoningLevel: String(r.reasoningLevel ?? 'default'), providerId: r.providerId == null ? null : String(r.providerId), profileId: String(r.profileId), workspacePath: r.workspacePath == null ? null : String(r.workspacePath), createdAt: String(r.createdAt), updatedAt: String(r.updatedAt) })),
      messages: rows('SELECT id, conversation_id AS conversationId, role, content, created_at AS createdAt FROM messages').map((r) => ({ id: String(r.id), conversationId: String(r.conversationId), role: r.role as 'user' | 'assistant', content: String(r.content), createdAt: String(r.createdAt) })),
      runs: rows('SELECT id, conversation_id AS conversationId, input_message_id AS inputMessageId, status, error, started_at AS startedAt, finished_at AS finishedAt, input_tokens AS inputTokens, output_tokens AS outputTokens, total_tokens AS totalTokens, context_tokens AS contextTokens, context_window AS contextWindow, context_percent AS contextPercent FROM runs').map((r) => ({ id: String(r.id), conversationId: String(r.conversationId), inputMessageId: r.inputMessageId == null ? null : String(r.inputMessageId), status: r.status as RunStatus, error: r.error == null ? null : String(r.error), startedAt: String(r.startedAt), finishedAt: r.finishedAt == null ? null : String(r.finishedAt), inputTokens: r.inputTokens == null ? null : Number(r.inputTokens), outputTokens: r.outputTokens == null ? null : Number(r.outputTokens), totalTokens: r.totalTokens == null ? null : Number(r.totalTokens), contextTokens: r.contextTokens == null ? null : Number(r.contextTokens), contextWindow: r.contextWindow == null ? null : Number(r.contextWindow), contextPercent: r.contextPercent == null ? null : Number(r.contextPercent) })),
      runActivities: rows('SELECT id, run_id AS runId, tool_call_id AS toolCallId, tool_name AS toolName, status, input, output, started_at AS startedAt, finished_at AS finishedAt FROM run_activities').map((r) => ({ id: String(r.id), runId: String(r.runId), toolCallId: String(r.toolCallId), toolName: String(r.toolName), status: r.status as RunActivityStatus, input: r.input == null ? null : String(r.input), output: r.output == null ? null : String(r.output), startedAt: String(r.startedAt), finishedAt: r.finishedAt == null ? null : String(r.finishedAt) })),
      runArtifacts: rows('SELECT id, run_id AS runId, tool_call_id AS toolCallId, kind, mime_type AS mimeType, size, url, created_at AS createdAt FROM run_artifacts').map((r) => ({ id: String(r.id), runId: String(r.runId), toolCallId: String(r.toolCallId), kind: r.kind as RunArtifact['kind'], mimeType: String(r.mimeType), size: Number(r.size), url: String(r.url), createdAt: String(r.createdAt) })),
      providers: rows('SELECT id, protocol, base_url AS baseUrl, model, display_name AS displayName, context_window AS contextWindow, supports_images AS supportsImages, updated_at AS updatedAt FROM provider_profiles').map((r) => ({ id: String(r.id), protocol: r.protocol as ProviderConfig['protocol'], baseUrl: String(r.baseUrl), model: String(r.model), displayName: String(r.displayName), contextWindow: Number(r.contextWindow), supportsImages: Number(r.supportsImages) === 1, updatedAt: String(r.updatedAt) })),
      appSettings: rows("SELECT key, value, updated_at AS updatedAt FROM app_settings WHERE key IN ('browser_use', 'computer_use', 'desktop_presence', 'desktop_pet', 'active_knowledge_base_id') OR key LIKE 'conversation_capabilities:%'").map((r) => ({ key: String(r.key), value: String(r.value), updatedAt: String(r.updatedAt) })),
      taskBoards: rows('SELECT id, name, position FROM task_boards').map((r) => ({ id: String(r.id), name: String(r.name), position: Number(r.position) })),
      taskTypes: rows('SELECT id, board_id AS boardId, name, position FROM task_types').map((r) => ({ id: String(r.id), boardId: String(r.boardId), name: String(r.name), position: Number(r.position) })),
      tasks: rows('SELECT id, board_id AS boardId, title, description, position, status, priority, due_at AS dueAt, remind_at AS remindAt, reminder_fired_at AS reminderFiredAt, source_conversation_id AS sourceConversationId, created_at AS createdAt, updated_at AS updatedAt FROM tasks').map((r) => ({ id: String(r.id), boardId: String(r.boardId), title: String(r.title), description: String(r.description ?? ''), position: Number(r.position ?? 0), status: String(r.status), priority: r.priority as TaskPriority, dueAt: r.dueAt == null ? null : String(r.dueAt), remindAt: r.remindAt == null ? null : String(r.remindAt), reminderFiredAt: r.reminderFiredAt == null ? null : String(r.reminderFiredAt), sourceConversationId: r.sourceConversationId == null ? null : String(r.sourceConversationId), createdAt: String(r.createdAt), updatedAt: String(r.updatedAt) })),
      knowledgeBases: rows('SELECT id, name, icon, color, position, archived, created_at AS createdAt, updated_at AS updatedAt FROM knowledge_bases ORDER BY position, id').map((r) => ({ id: String(r.id), name: String(r.name), icon: r.icon == null ? null : String(r.icon), color: r.color == null ? null : String(r.color), position: Number(r.position ?? 0), archived: Number(r.archived) === 1, createdAt: String(r.createdAt), updatedAt: String(r.updatedAt) })),
      notes: rows('SELECT id, knowledge_base_id AS knowledgeBaseId, parent_id AS parentId, title, content, icon, cover, properties_json AS propertiesJson, position, archived, favorite, last_opened_at AS lastOpenedAt, created_at AS createdAt, updated_at AS updatedAt FROM notes ORDER BY CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END, parent_id, position, id').map((r) => ({ id: String(r.id), knowledgeBaseId: r.knowledgeBaseId == null ? null : String(r.knowledgeBaseId), parentId: r.parentId == null ? null : String(r.parentId), title: String(r.title), content: String(r.content ?? ''), icon: r.icon == null ? null : String(r.icon), cover: normalizeNoteCover(r.cover), properties: normalizeNoteProperties(r.propertiesJson), position: Number(r.position ?? 0), archived: Number(r.archived) === 1, favorite: Number(r.favorite) === 1, lastOpenedAt: r.lastOpenedAt == null ? null : String(r.lastOpenedAt), createdAt: String(r.createdAt), updatedAt: String(r.updatedAt) })),
      noteVersions: rows('SELECT id, note_id AS noteId, title, content, icon, cover, properties_json AS propertiesJson, created_at AS createdAt FROM note_versions ORDER BY created_at, rowid').map((r) => ({ id: String(r.id), noteId: String(r.noteId), title: String(r.title), content: String(r.content ?? ''), icon: r.icon == null ? null : String(r.icon), cover: normalizeNoteCover(r.cover), properties: normalizeNoteProperties(r.propertiesJson), createdAt: String(r.createdAt) })),
    };
  }

  import(snapshot: FullBackupSnapshot): BackupImportReport {
    const projectMap = new Map<string, string>();
    const boardMap = new Map<string, string>();
    const typeMap = new Map<string, string>();
    const conversationMap = new Map<string, string>();
    const messageMap = new Map<string, string>();
    const runMap = new Map<string, string>();
    const noteMap = new Map<string, string>();
    const knowledgeBaseMap = new Map<string, string>();
    let importedTasks = 0;
    let importedNotes = 0;
    const providerIds = new Set(this.listProviderIds());
    const defaultProvider = this.defaultProviderId();
    const now = new Date().toISOString();

    this.transaction(() => {
      const defaultKnowledgeBase = this.db.prepare("SELECT id FROM knowledge_bases WHERE id = 'default'").get() as Row | undefined;
      const targetDefaultKnowledgeBaseId = defaultKnowledgeBase ? 'default' : String((this.db.prepare('SELECT id FROM knowledge_bases ORDER BY archived ASC, position ASC, id ASC LIMIT 1').get() as Row).id);
      for (const item of snapshot.knowledgeBases ?? []) {
        if (item.id === 'default') { knowledgeBaseMap.set(item.id, targetDefaultKnowledgeBaseId); continue; }
        const id = crypto.randomUUID();
        knowledgeBaseMap.set(item.id, id);
        this.db.prepare('INSERT INTO knowledge_bases (id, name, icon, color, position, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, item.name, item.icon ?? null, item.color ?? null, item.position, item.archived ? 1 : 0, item.createdAt || now, item.updatedAt || now);
      }
      const insertProject = this.db.prepare('INSERT INTO conversation_projects (id, name, position, workspace_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
      for (const item of snapshot.conversationProjects) {
        const id = crypto.randomUUID();
        projectMap.set(item.id, id);
        insertProject.run(id, item.name, item.position, item.workspacePath ?? null, item.createdAt || now, item.updatedAt || now);
      }
      if (!projectMap.has('personal')) projectMap.set('personal', 'personal');

      const insertConversation = this.db.prepare('INSERT INTO conversations (id, project_id, title, description, archived, pinned, reasoning_level, provider_id, profile_id, workspace_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const item of snapshot.conversations) {
        const id = crypto.randomUUID();
        conversationMap.set(item.id, id);
        const providerId = item.providerId && providerIds.has(item.providerId) ? item.providerId : defaultProvider;
        const profileId = isAgentProfileId(item.profileId) ? item.profileId : DEFAULT_AGENT_PROFILE_ID;
        insertConversation.run(id, projectMap.get(item.projectId) ?? 'personal', item.title, item.description, item.archived ? 1 : 0, item.pinned ? 1 : 0, item.reasoningLevel, providerId, profileId, item.workspacePath ?? null, item.createdAt || now, item.updatedAt || now);
      }

      const insertMessage = this.db.prepare('INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)');
      for (const item of snapshot.messages) {
        const conversationId = conversationMap.get(item.conversationId);
        if (!conversationId) continue;
        const id = crypto.randomUUID();
        messageMap.set(item.id, id);
        insertMessage.run(id, conversationId, item.role === 'assistant' ? 'assistant' : 'user', item.content, item.createdAt || now);
      }

      const runInsert = this.db.prepare('INSERT INTO runs (id, conversation_id, input_message_id, status, error, started_at, finished_at, input_tokens, output_tokens, total_tokens, context_tokens, context_window, context_percent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const item of snapshot.runs) {
        const conversationId = conversationMap.get(item.conversationId);
        if (!conversationId) continue;
        const id = crypto.randomUUID();
        runMap.set(item.id, id);
        const status = item.status === 'completed' || item.status === 'failed' || item.status === 'cancelled' || item.status === 'interrupted' ? item.status : 'interrupted';
        runInsert.run(id, conversationId, item.inputMessageId ? messageMap.get(item.inputMessageId) ?? null : null, status, item.error, item.startedAt || now, item.finishedAt || now, item.inputTokens, item.outputTokens, item.totalTokens, item.contextTokens, item.contextWindow, item.contextPercent);
      }
      const activityInsert = this.db.prepare('INSERT INTO run_activities (id, run_id, tool_call_id, tool_name, status, input, output, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const item of snapshot.runActivities) {
        const runId = runMap.get(item.runId);
        if (runId) activityInsert.run(crypto.randomUUID(), runId, item.toolCallId, item.toolName, item.status === 'running' ? 'cancelled' : item.status, item.input, item.output, item.startedAt || now, item.finishedAt || now);
      }
      const artifactInsert = this.db.prepare('INSERT INTO run_artifacts (id, run_id, tool_call_id, kind, mime_type, size, url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const item of snapshot.runArtifacts) {
        const runId = runMap.get(item.runId);
        if (runId) artifactInsert.run(crypto.randomUUID(), runId, item.toolCallId, item.kind, item.mimeType, item.size, item.url, item.createdAt || now);
      }

      for (const item of snapshot.taskBoards) {
        const id = crypto.randomUUID();
        boardMap.set(item.id, id);
        this.db.prepare('INSERT INTO task_boards (id, name, position) VALUES (?, ?, ?)').run(id, item.name, item.position);
      }
      for (const item of snapshot.taskTypes) {
        const boardId = boardMap.get(item.boardId);
        if (!boardId) continue;
        const id = crypto.randomUUID();
        typeMap.set(item.id, id);
        this.db.prepare('INSERT INTO task_types (id, board_id, name, position) VALUES (?, ?, ?, ?)').run(id, boardId, item.name, item.position);
      }
      for (const item of snapshot.tasks) {
        const boardId = boardMap.get(item.boardId);
        const status = typeMap.get(item.status);
        if (!boardId || !status) continue;
        this.db.prepare('INSERT INTO tasks (id, board_id, title, description, position, status, priority, due_at, remind_at, reminder_fired_at, source_conversation_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(crypto.randomUUID(), boardId, item.title, item.description, item.position, status, item.priority, item.dueAt, item.remindAt, item.reminderFiredAt, item.sourceConversationId ? conversationMap.get(item.sourceConversationId) ?? null : null, item.createdAt || now, item.updatedAt || now);
        importedTasks += 1;
      }

      const pendingNotes = [...(snapshot.notes ?? [])];
      const insertNote = this.db.prepare('INSERT INTO notes (id, parent_id, title, content, icon, cover, properties_json, position, archived, favorite, last_opened_at, created_at, updated_at, knowledge_base_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      while (pendingNotes.length) {
        let progressed = false;
        for (let index = pendingNotes.length - 1; index >= 0; index -= 1) {
          const item = pendingNotes[index];
          const mappedParentId = item.parentId == null ? null : noteMap.get(item.parentId);
          if (item.parentId != null && !mappedParentId) continue;
          const id = crypto.randomUUID();
          noteMap.set(item.id, id);
          const knowledgeBaseId = knowledgeBaseMap.get(item.knowledgeBaseId ?? '') ?? targetDefaultKnowledgeBaseId;
          insertNote.run(id, mappedParentId ?? null, item.title, item.content, typeof item.icon === 'string' ? item.icon.trim().slice(0, 32) || null : null, normalizeNoteCover(item.cover), JSON.stringify(normalizeNoteProperties(item.properties ?? {})), item.position, item.archived ? 1 : 0, item.favorite ? 1 : 0, typeof item.lastOpenedAt === 'string' ? item.lastOpenedAt : null, item.createdAt || now, item.updatedAt || now, knowledgeBaseId);
          pendingNotes.splice(index, 1);
          importedNotes += 1;
          progressed = true;
        }
        if (!progressed) break;
      }

      const importedNoteLink = /yuheng-note:\/\/([^\s)]+)/gu;
      for (const mappedId of noteMap.values()) {
        const row = this.db.prepare('SELECT content FROM notes WHERE id = ?').get(mappedId) as Row | undefined;
        if (!row) continue;
        const original = String(row.content ?? '');
        const content = original.replace(importedNoteLink, (url, encodedId: string) => {
          let sourceId: string;
          try { sourceId = decodeURIComponent(encodedId); } catch { return url; }
          const replacement = noteMap.get(sourceId);
          return replacement ? `yuheng-note://${encodeURIComponent(replacement)}` : url;
        });
        if (content !== original) this.db.prepare('UPDATE notes SET content = ? WHERE id = ?').run(content, mappedId);
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
            let sourceId: string;
            try { sourceId = decodeURIComponent(encodedId); } catch { return url; }
            const replacement = noteMap.get(sourceId);
            return replacement ? `yuheng-note://${encodeURIComponent(replacement)}` : url;
          });
          insertVersion.run(crypto.randomUUID(), noteId, version.title, content, typeof version.icon === 'string' ? version.icon.trim().slice(0, 32) || null : null, normalizeNoteCover(version.cover), JSON.stringify(normalizeNoteProperties(version.properties ?? {})), version.createdAt || now);
        }
      }

      const insertSetting = this.db.prepare("INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)");
      for (const item of snapshot.appSettings) {
        if (item.key === 'browser_use' || item.key === 'computer_use' || item.key === 'desktop_presence' || item.key === 'desktop_pet') {
          insertSetting.run(item.key, item.value, item.updatedAt || now);
          continue;
        }
        if (item.key === 'active_knowledge_base_id') {
          try {
            const sourceId = JSON.parse(item.value);
            const targetId = typeof sourceId === 'string' ? knowledgeBaseMap.get(sourceId) : undefined;
            if (targetId) insertSetting.run(item.key, JSON.stringify(targetId), item.updatedAt || now);
          } catch { /* ignore malformed optional setting */ }
          continue;
        }
        const sourceConversationId = item.key.startsWith('conversation_capabilities:') ? item.key.slice('conversation_capabilities:'.length) : '';
        const targetConversationId = sourceConversationId ? conversationMap.get(sourceConversationId) : undefined;
        if (targetConversationId) insertSetting.run(`conversation_capabilities:${targetConversationId}`, item.value, item.updatedAt || now);
      }
    });
    return { conversations: conversationMap.size, messages: messageMap.size, tasks: importedTasks, notes: importedNotes, missingProviders: snapshot.providers.filter((provider) => !providerIds.has(provider.id)).length, conversationMap: Object.fromEntries(conversationMap) };
  }

  private listProviderIds(): string[] {
    return (this.db.prepare('SELECT id FROM provider_profiles').all() as Row[]).map((row) => String(row.id));
  }

  private defaultProviderId(): string | null {
    const configured = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get('default_provider_id') as Row | undefined;
    if (configured) {
      try {
        const id = JSON.parse(String(configured.value));
        if (typeof id === 'string' && id.trim() && this.db.prepare('SELECT 1 FROM provider_profiles WHERE id = ?').get(id.trim())) return id.trim();
      } catch {
        // Ignore damaged settings and retain the legacy deterministic fallback.
      }
    }
    const row = this.db.prepare("SELECT id FROM provider_profiles ORDER BY CASE WHEN id = 'default' THEN 0 ELSE 1 END, updated_at ASC, id ASC LIMIT 1").get() as Row | undefined;
    return row ? String(row.id) : null;
  }

}
