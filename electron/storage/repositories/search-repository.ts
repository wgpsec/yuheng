import type { SearchResult, SearchResultKind } from '../../store';
import { RepositoryBase } from './repository-base';

type Row = Record<string, unknown>;

const MAX_QUERY_LENGTH = 120;
const MAX_RESULTS = 50;

export class SearchRepository extends RepositoryBase {
  private fullTextAvailable = false;

  initialize(): void {
    try {
      this.transaction(() => {
        this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
          kind UNINDEXED, entity_id UNINDEXED, parent_id UNINDEXED, title, content,
          context UNINDEXED, updated_at UNINDEXED, archived UNINDEXED, tokenize = 'trigram'
        );
        CREATE TRIGGER IF NOT EXISTS search_conversations_insert AFTER INSERT ON conversations BEGIN
          INSERT INTO search_index(kind, entity_id, parent_id, title, content, context, updated_at, archived)
          VALUES ('conversation', NEW.id, NULL, NEW.title, NEW.description, '会话', NEW.updated_at, NEW.archived);
        END;
        CREATE TRIGGER IF NOT EXISTS search_conversations_update AFTER UPDATE ON conversations BEGIN
          DELETE FROM search_index WHERE kind = 'conversation' AND entity_id = OLD.id;
          INSERT INTO search_index(kind, entity_id, parent_id, title, content, context, updated_at, archived)
          VALUES ('conversation', NEW.id, NULL, NEW.title, NEW.description, '会话', NEW.updated_at, NEW.archived);
          UPDATE search_index SET title = NEW.title, archived = NEW.archived WHERE kind = 'message' AND parent_id = NEW.id;
        END;
        CREATE TRIGGER IF NOT EXISTS search_conversations_delete AFTER DELETE ON conversations BEGIN
          DELETE FROM search_index WHERE (kind = 'conversation' AND entity_id = OLD.id) OR (kind = 'message' AND parent_id = OLD.id);
        END;
        CREATE TRIGGER IF NOT EXISTS search_messages_insert AFTER INSERT ON messages BEGIN
          INSERT INTO search_index(kind, entity_id, parent_id, title, content, context, updated_at, archived)
          SELECT 'message', NEW.id, NEW.conversation_id, title, NEW.content, CASE NEW.role WHEN 'user' THEN '你' ELSE '玉衡' END, NEW.created_at, archived
          FROM conversations WHERE id = NEW.conversation_id;
        END;
        CREATE TRIGGER IF NOT EXISTS search_messages_update AFTER UPDATE ON messages BEGIN
          DELETE FROM search_index WHERE kind = 'message' AND entity_id = OLD.id;
          INSERT INTO search_index(kind, entity_id, parent_id, title, content, context, updated_at, archived)
          SELECT 'message', NEW.id, NEW.conversation_id, title, NEW.content, CASE NEW.role WHEN 'user' THEN '你' ELSE '玉衡' END, NEW.created_at, archived
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
          SELECT 'task', NEW.id, NEW.board_id, NEW.title, NEW.description, name, NEW.updated_at, 0 FROM task_boards WHERE id = NEW.board_id;
        END;
        CREATE TRIGGER IF NOT EXISTS search_tasks_update AFTER UPDATE ON tasks BEGIN
          DELETE FROM search_index WHERE kind = 'task' AND entity_id = OLD.id;
          INSERT INTO search_index(kind, entity_id, parent_id, title, content, context, updated_at, archived)
          SELECT 'task', NEW.id, NEW.board_id, NEW.title, NEW.description, name, NEW.updated_at, 0 FROM task_boards WHERE id = NEW.board_id;
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
        this.rebuild();
      });
      this.fullTextAvailable = true;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('no such module: fts5')) throw error;
      this.transaction(() => {
        for (const trigger of ['search_conversations_insert', 'search_conversations_update', 'search_conversations_delete', 'search_messages_insert', 'search_messages_update', 'search_messages_delete', 'search_boards_insert', 'search_boards_update', 'search_boards_delete', 'search_tasks_insert', 'search_tasks_update', 'search_tasks_delete', 'search_notes_insert', 'search_notes_update', 'search_notes_delete']) {
          this.db.exec(`DROP TRIGGER IF EXISTS ${trigger}`);
        }
      });
      this.fullTextAvailable = false;
    }
  }

  hasFullTextIndex(): boolean {
    return this.fullTextAvailable || Boolean(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'search_index'").get());
  }

  search(rawQuery: string, requestedLimit = 30): SearchResult[] {
    const query = rawQuery.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH);
    const limit = Math.max(1, Math.min(MAX_RESULTS, Math.floor(requestedLimit) || 30));
    if (!query) return this.recent(limit);
    if (!this.fullTextAvailable || [...query].length < 3) return this.like(query, limit);
    try {
      const match = `"${query.replace(/"/g, '""')}"`;
      const rows = this.db.prepare(`SELECT kind, entity_id AS id, parent_id AS parentId, title,
        snippet(search_index, -1, '', '', ' … ', 24) AS snippet, context, updated_at AS updatedAt, archived
        FROM search_index WHERE search_index MATCH ? ORDER BY bm25(search_index, 0, 0, 0, 5, 1), updated_at DESC LIMIT ?`).all(match, limit) as Row[];
      return rows.map((row) => this.map(row, query));
    } catch {
      return this.like(query, limit);
    }
  }

  private rebuild(): void {
    this.db.exec(`
      DELETE FROM search_index;
      INSERT INTO search_index(kind, entity_id, parent_id, title, content, context, updated_at, archived)
        SELECT 'conversation', id, NULL, title, description, '会话', updated_at, archived FROM conversations;
      INSERT INTO search_index(kind, entity_id, parent_id, title, content, context, updated_at, archived)
        SELECT 'message', messages.id, conversation_id, conversations.title, messages.content, CASE messages.role WHEN 'user' THEN '你' ELSE '玉衡' END, messages.created_at, conversations.archived FROM messages JOIN conversations ON conversations.id = messages.conversation_id;
      INSERT INTO search_index(kind, entity_id, parent_id, title, content, context, updated_at, archived)
        SELECT 'board', id, NULL, name, '', '任务看板', '', 0 FROM task_boards;
      INSERT INTO search_index(kind, entity_id, parent_id, title, content, context, updated_at, archived)
        SELECT 'task', tasks.id, board_id, tasks.title, tasks.description, task_boards.name, tasks.updated_at, 0 FROM tasks JOIN task_boards ON task_boards.id = tasks.board_id;
      INSERT INTO search_index(kind, entity_id, parent_id, title, content, context, updated_at, archived)
        SELECT 'note', id, parent_id, title, content, '笔记', updated_at, archived FROM notes;
    `);
  }

  private recent(limit: number): SearchResult[] {
    const rows = this.db.prepare(`
      SELECT 'conversation' AS kind, id, NULL AS parentId, title, description AS content, '会话' AS context, updated_at AS updatedAt, archived, 0 AS sortPriority FROM conversations
      UNION ALL SELECT 'task', tasks.id, board_id, tasks.title, tasks.description, task_boards.name, tasks.updated_at, 0, 0 FROM tasks JOIN task_boards ON task_boards.id = tasks.board_id
      UNION ALL SELECT 'note', id, parent_id, title, content, '笔记', COALESCE(last_opened_at, updated_at), archived, CASE WHEN favorite = 1 THEN 1 ELSE 0 END FROM notes
      ORDER BY sortPriority DESC, updatedAt DESC LIMIT ?`).all(limit) as Row[];
    return rows.map((row) => this.map(row, ''));
  }

  private like(query: string, limit: number): SearchResult[] {
    const pattern = `%${query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
    const rows = this.db.prepare(`
      SELECT 'conversation' AS kind, id, NULL AS parentId, title, description AS content, '会话' AS context, updated_at AS updatedAt, archived FROM conversations WHERE title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'
      UNION ALL SELECT 'message', messages.id, conversation_id, conversations.title, messages.content, CASE messages.role WHEN 'user' THEN '你' ELSE '玉衡' END, messages.created_at, conversations.archived FROM messages JOIN conversations ON conversations.id = messages.conversation_id WHERE messages.content LIKE ? ESCAPE '\\'
      UNION ALL SELECT 'task', tasks.id, board_id, tasks.title, tasks.description, task_boards.name, tasks.updated_at, 0 FROM tasks JOIN task_boards ON task_boards.id = tasks.board_id WHERE tasks.title LIKE ? ESCAPE '\\' OR tasks.description LIKE ? ESCAPE '\\'
      UNION ALL SELECT 'board', id, NULL, name, '', '任务看板', '', 0 FROM task_boards WHERE name LIKE ? ESCAPE '\\'
      UNION ALL SELECT 'note', id, parent_id, title, content, '笔记', updated_at, archived FROM notes WHERE title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\'
      ORDER BY updatedAt DESC LIMIT ?`).all(pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern, limit) as Row[];
    return rows.map((row) => this.map(row, query));
  }

  private map(row: Row, query: string): SearchResult {
    const title = String(row.title ?? '');
    const content = String(row.content ?? row.snippet ?? '');
    return { kind: row.kind as SearchResultKind, id: String(row.id), parentId: row.parentId == null ? null : String(row.parentId), title, snippet: snippet(content || title, query), context: String(row.context ?? ''), updatedAt: String(row.updatedAt ?? ''), archived: Boolean(row.archived) };
  }
}

function snippet(value: string, query: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  const max = 150;
  if (!query || normalized.length <= max) return normalized;
  const index = normalized.toLocaleLowerCase('zh-CN').indexOf(query.toLocaleLowerCase('zh-CN'));
  const start = Math.max(0, index < 0 ? 0 : index - 45);
  const end = Math.min(normalized.length, start + max);
  return `${start > 0 ? '…' : ''}${normalized.slice(start, end).trim()}${end < normalized.length ? '…' : ''}`;
}
