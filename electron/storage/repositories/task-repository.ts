import crypto from 'node:crypto';
import type { CreateTaskInput, Task, TaskBoard, TaskPriority, TaskStatus, TaskType, UpdateTaskInput } from '../../store';
import { RepositoryBase } from './repository-base';

type Row = Record<string, unknown>;

export type TaskRepositoryRow = Task;

const DEFAULT_BOARD_ID = 'default';

export class TaskRepository extends RepositoryBase {

  listBoards(): TaskBoard[] {
    const rows = this.db.prepare('SELECT id, name, position FROM task_boards ORDER BY position ASC, id ASC').all() as Row[];
    return rows.map((row) => ({ id: String(row.id), name: String(row.name), position: Number(row.position) }));
  }

  createBoard(name: string): TaskBoard {
    const normalized = name.trim();
    if (!normalized) throw new Error('Task board name is required.');
    const id = crypto.randomUUID();
    const position = Number((this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM task_boards').get() as Row).position);
    this.transaction(() => {
      this.db.prepare('INSERT INTO task_boards (id, name, position) VALUES (?, ?, ?)').run(id, normalized, position);
      const insertType = this.db.prepare('INSERT INTO task_types (id, board_id, name, position) VALUES (?, ?, ?, ?)');
      for (const [suffix, typeName, typePosition] of [['todo', '待处理', 0], ['in_progress', '进行中', 1], ['done', '已完成', 2], ['archived', '已归档', 3]] as const) {
        insertType.run(`${id}:${suffix}`, id, typeName, typePosition);
      }
    });
    return { id, name: normalized, position };
  }

  renameBoard(id: string, name: string): TaskBoard {
    const normalized = name.trim();
    if (!normalized) throw new Error('Task board name is required.');
    const result = this.db.prepare('UPDATE task_boards SET name = ? WHERE id = ?').run(normalized, id);
    if (Number(result.changes) === 0) throw new Error('Task board not found.');
    const row = this.db.prepare('SELECT id, name, position FROM task_boards WHERE id = ?').get(id) as Row;
    return { id: String(row.id), name: String(row.name), position: Number(row.position) };
  }

  reorderBoards(id: string, targetId: string): TaskBoard[] {
    const boards = this.listBoards();
    const sourceIndex = boards.findIndex((board) => board.id === id);
    const targetIndex = boards.findIndex((board) => board.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) throw new Error('Task board not found.');
    if (sourceIndex === targetIndex) return boards;
    const [moved] = boards.splice(sourceIndex, 1);
    boards.splice(targetIndex, 0, moved);
    this.transaction(() => {
      const update = this.db.prepare('UPDATE task_boards SET position = ? WHERE id = ?');
      boards.forEach((board, position) => update.run(position, board.id));
    });
    return this.listBoards();
  }

  deleteBoard(id: string, replacementBoardId: string): void {
    if (!id) throw new Error('Task board id is required.');
    const replacementId = replacementBoardId.trim();
    this.transaction(() => {
      const source = this.db.prepare('SELECT position FROM task_boards WHERE id = ?').get(id) as Row | undefined;
      if (!source) throw new Error('Task board not found.');
      if (replacementId === id) throw new Error('请选择不同的替代看板。');
      if (replacementId && !this.db.prepare('SELECT 1 FROM task_boards WHERE id = ?').get(replacementId)) throw new Error('Replacement task board not found.');
      const wasDefault = this.getDefaultBoardId() === id;
      const boardCount = Number((this.db.prepare('SELECT COUNT(*) AS count FROM task_boards').get() as Row).count);
      if (boardCount <= 1) throw new Error('At least one task board is required.');

      const tasks = this.db.prepare(`SELECT tasks.id, tasks.status, task_types.name AS typeName
        FROM tasks LEFT JOIN task_types ON task_types.id = tasks.status
        WHERE tasks.board_id = ? ORDER BY task_types.position ASC, tasks.position ASC, tasks.updated_at DESC, tasks.id ASC`).all(id) as Row[];
      if (tasks.length > 0 && !replacementId) throw new Error('看板中仍有任务，请选择替代看板。');

      let defaultReplacementId = replacementId;
      if (wasDefault && !defaultReplacementId) {
        const fallback = this.db.prepare('SELECT id FROM task_boards WHERE id != ? ORDER BY position ASC, id ASC LIMIT 1').get(id) as Row | undefined;
        if (!fallback) throw new Error('At least one task board is required.');
        defaultReplacementId = String(fallback.id);
      }

      if (tasks.length > 0) {
        const targetTypes = this.db.prepare('SELECT id, name, position FROM task_types WHERE board_id = ? ORDER BY position ASC, id ASC').all(replacementId) as Row[];
        if (targetTypes.length === 0) throw new Error('Target task board has no task types.');
        const targetByName = new Map<string, Row>();
        for (const type of targetTypes) if (!targetByName.has(String(type.name))) targetByName.set(String(type.name), type);
        const nextPosition = new Map<string, number>();
        for (const type of targetTypes) {
          nextPosition.set(String(type.id), Number((this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM tasks WHERE board_id = ? AND status = ?').get(replacementId, String(type.id)) as Row).position));
        }
        const fallbackType = targetTypes[0];
        const updateTask = this.db.prepare('UPDATE tasks SET board_id = ?, status = ?, position = ?, updated_at = ? WHERE id = ?');
        const now = new Date().toISOString();
        for (const task of tasks) {
          const targetType = (task.typeName == null ? undefined : targetByName.get(String(task.typeName))) ?? fallbackType;
          const targetTypeId = String(targetType.id);
          const position = nextPosition.get(targetTypeId) ?? 0;
          updateTask.run(replacementId, targetTypeId, position, now, String(task.id));
          nextPosition.set(targetTypeId, position + 1);
        }
      }

      const result = this.db.prepare('DELETE FROM task_boards WHERE id = ?').run(id);
      if (Number(result.changes) === 0) throw new Error('Task board not found.');
      const position = Number(source.position);
      this.db.prepare('UPDATE task_boards SET position = position - 1 WHERE position > ?').run(position);
      if (wasDefault) this.setDefaultBoardId(defaultReplacementId);
    });
  }

  list(boardId?: string): Task[] {
    boardId ??= this.getDefaultBoardId();
    const rows = this.db.prepare(`SELECT id, board_id AS boardId, title, description, status, priority, due_at AS dueAt,
      remind_at AS remindAt, reminder_fired_at AS reminderFiredAt, source_conversation_id AS sourceConversationId,
      created_at AS createdAt, updated_at AS updatedAt FROM tasks WHERE board_id = ?
      ORDER BY status ASC, position ASC, updated_at DESC`).all(boardId) as Row[];
    return rows.map((row) => this.mapTask(row));
  }

  listTypes(boardId?: string): TaskType[] {
    boardId ??= this.getDefaultBoardId();
    const rows = this.db.prepare('SELECT id, board_id AS boardId, name, position FROM task_types WHERE board_id = ? ORDER BY position ASC, id ASC').all(boardId) as Row[];
    return rows.map((row) => ({ id: String(row.id), boardId: String(row.boardId), name: String(row.name), position: Number(row.position) }));
  }

  createType(name: string, boardId?: string): TaskType {
    boardId ??= this.getDefaultBoardId();
    const normalized = name.trim();
    if (!normalized) throw new Error('Task type name is required.');
    const id = crypto.randomUUID();
    const position = Number((this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM task_types WHERE board_id = ?').get(boardId) as Row).position);
    this.db.prepare('INSERT INTO task_types (id, board_id, name, position) VALUES (?, ?, ?, ?)').run(id, boardId, normalized, position);
    return { id, boardId, name: normalized, position };
  }

  renameType(id: string, name: string): TaskType {
    const normalized = name.trim();
    if (!normalized) throw new Error('Task type name is required.');
    const result = this.db.prepare('UPDATE task_types SET name = ? WHERE id = ?').run(normalized, id);
    if (Number(result.changes) === 0) throw new Error('Task type not found.');
    return this.getType(id);
  }

  deleteType(id: string): TaskType {
    const type = this.getType(id);
    const count = Number((this.db.prepare('SELECT COUNT(*) AS count FROM task_types WHERE board_id = ?').get(type.boardId) as Row).count);
    if (count <= 1) throw new Error('At least one task type is required.');
    const taskCount = Number((this.db.prepare('SELECT COUNT(*) AS count FROM tasks WHERE status = ?').get(id) as Row).count);
    if (taskCount > 0) throw new Error('Task type still contains tasks. Move or delete them first.');
    this.transaction(() => {
      this.db.prepare('DELETE FROM task_types WHERE id = ?').run(id);
      this.db.prepare('UPDATE task_types SET position = position - 1 WHERE board_id = ? AND position > ?').run(type.boardId, type.position);
    });
    return type;
  }

  create(input: CreateTaskInput, boardId?: string): Task {
    boardId ??= this.getDefaultBoardId();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const status = input.status ?? this.listTypes(boardId)[0]?.id;
    if (!status) throw new Error('At least one task type is required.');
    this.assertStatus(status, boardId);
    const position = Number((this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM tasks WHERE board_id = ? AND status = ?').get(boardId, status) as Row).position);
    this.db.prepare(`INSERT INTO tasks
      (id, board_id, title, description, position, status, priority, due_at, remind_at, source_conversation_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, boardId, input.title, input.description ?? '', position, status, input.priority ?? 'medium', input.dueAt ?? null, input.remindAt ?? null, input.sourceConversationId ?? null, now, now);
    return this.get(id);
  }

  update(id: string, patch: UpdateTaskInput): Task {
    const existing = this.get(id);
    if (patch.status !== undefined) this.assertStatus(patch.status, existing.boardId);
    const assignments: string[] = [];
    const values: (string | number | null)[] = [];
    for (const [key, column] of [['title', 'title'], ['description', 'description'], ['status', 'status'], ['priority', 'priority'], ['dueAt', 'due_at'], ['remindAt', 'remind_at']] as const) {
      if (patch[key] === undefined) continue;
      assignments.push(`${column} = ?`);
      values.push(patch[key] ?? null);
    }
    if (patch.status !== undefined && patch.status !== existing.status) {
      const position = Number((this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM tasks WHERE board_id = ? AND status = ?').get(existing.boardId, patch.status) as Row).position);
      assignments.push('position = ?');
      values.push(position);
    }
    if (assignments.length === 0) return existing;
    if (patch.remindAt !== undefined && patch.remindAt !== existing.remindAt) assignments.push('reminder_fired_at = NULL');
    assignments.push('updated_at = ?');
    values.push(new Date().toISOString(), id);
    const result = this.db.prepare(`UPDATE tasks SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
    if (Number(result.changes) === 0) throw new Error('Task not found.');
    return this.get(id);
  }

  reorder(id: string, targetId: string): Task[] {
    const source = this.get(id);
    const target = this.get(targetId);
    if (source.boardId !== target.boardId || source.status !== target.status) throw new Error('Tasks must share a column to reorder.');
    const rows = this.db.prepare('SELECT id FROM tasks WHERE board_id = ? AND status = ? ORDER BY position ASC, updated_at DESC, id ASC').all(source.boardId, source.status) as Row[];
    const sourceIndex = rows.findIndex((row) => row.id === id);
    const targetIndex = rows.findIndex((row) => row.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return this.list(source.boardId);
    const [moved] = rows.splice(sourceIndex, 1);
    rows.splice(targetIndex, 0, moved);
    this.transaction(() => {
      const update = this.db.prepare('UPDATE tasks SET position = ? WHERE id = ?');
      rows.forEach((row, position) => update.run(position, String(row.id)));
    });
    return this.list(source.boardId);
  }

  moveToBoard(id: string, boardId: string): Task {
    const existing = this.get(id);
    if (existing.boardId === boardId) return existing;
    if (!this.db.prepare('SELECT id FROM task_boards WHERE id = ?').get(boardId)) throw new Error('Task board not found.');
    const targetStatus = this.db.prepare('SELECT id FROM task_types WHERE board_id = ? ORDER BY position ASC, id ASC LIMIT 1').get(boardId) as Row | undefined;
    if (!targetStatus) throw new Error('Target task board has no task types.');
    const status = String(targetStatus.id);
    const position = Number((this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM tasks WHERE board_id = ? AND status = ?').get(boardId, status) as Row).position);
    const result = this.db.prepare('UPDATE tasks SET board_id = ?, status = ?, position = ?, updated_at = ? WHERE id = ?').run(boardId, status, position, new Date().toISOString(), id);
    if (Number(result.changes) === 0) throw new Error('Task not found.');
    return this.get(id);
  }

  copyToBoard(id: string, boardId: string): Task {
    const existing = this.get(id);
    const targetStatus = this.db.prepare('SELECT id FROM task_types WHERE board_id = ? ORDER BY position ASC, id ASC LIMIT 1').get(boardId) as Row | undefined;
    if (!targetStatus) throw new Error('Target task board has no task types.');
    return this.create({ title: existing.title, description: existing.description, priority: existing.priority, dueAt: existing.dueAt, remindAt: existing.remindAt, status: String(targetStatus.id), sourceConversationId: existing.sourceConversationId }, boardId);
  }

  delete(id: string): void {
    const result = this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    if (Number(result.changes) === 0) throw new Error('Task not found.');
  }

  get(id: string): Task {
    const row = this.db.prepare(`SELECT id, board_id AS boardId, title, description, status, priority, due_at AS dueAt,
      remind_at AS remindAt, reminder_fired_at AS reminderFiredAt, source_conversation_id AS sourceConversationId,
      created_at AS createdAt, updated_at AS updatedAt FROM tasks WHERE id = ?`).get(id) as Row | undefined;
    if (!row) throw new Error('Task not found.');
    return this.mapTask(row);
  }

  listPendingReminders(): Task[] {
    const rows = this.db.prepare(`SELECT id, board_id AS boardId, title, description, status, priority, due_at AS dueAt,
      remind_at AS remindAt, reminder_fired_at AS reminderFiredAt, source_conversation_id AS sourceConversationId,
      created_at AS createdAt, updated_at AS updatedAt FROM tasks
      WHERE remind_at IS NOT NULL AND reminder_fired_at IS NULL AND status != 'done' AND status != 'archived'
        AND status NOT LIKE '%:done' AND status NOT LIKE '%:archived' ORDER BY remind_at ASC`).all() as Row[];
    return rows.map((row) => this.mapTask(row));
  }

  markReminderFired(id: string, expectedRemindAt: string, firedAt = new Date().toISOString()): Task | null {
    const result = this.db.prepare('UPDATE tasks SET reminder_fired_at = ? WHERE id = ? AND remind_at = ? AND reminder_fired_at IS NULL').run(firedAt, id, expectedRemindAt);
    return Number(result.changes) === 0 ? null : this.get(id);
  }

  getDefaultBoardId(): string {
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get('default_task_board_id') as Row | undefined;
    if (row) {
      try {
        const configured = JSON.parse(String(row.value));
        if (typeof configured === 'string' && this.db.prepare('SELECT 1 FROM task_boards WHERE id = ?').get(configured)) return configured;
      } catch { /* Fall through to the legacy/default board. */ }
    }
    if (this.db.prepare('SELECT 1 FROM task_boards WHERE id = ?').get(DEFAULT_BOARD_ID)) return DEFAULT_BOARD_ID;
    const first = this.db.prepare('SELECT id FROM task_boards ORDER BY position ASC, id ASC LIMIT 1').get() as Row | undefined;
    if (!first) throw new Error('At least one task board is required.');
    return String(first.id);
  }

  private setDefaultBoardId(boardId: string): void {
    this.db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run('default_task_board_id', JSON.stringify(boardId), new Date().toISOString());
  }

  private getType(id: string): TaskType {
    const row = this.db.prepare('SELECT id, board_id AS boardId, name, position FROM task_types WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new Error('Task type not found.');
    return { id: String(row.id), boardId: String(row.boardId), name: String(row.name), position: Number(row.position) };
  }

  private assertStatus(status: TaskStatus, boardId: string): void {
    if (!this.db.prepare('SELECT 1 FROM task_types WHERE id = ? AND board_id = ?').get(status, boardId)) throw new Error('Task type not found.');
  }

  private mapTask(row: Row): Task {
    return {
      id: String(row.id), boardId: String(row.boardId), title: String(row.title), description: String(row.description ?? ''),
      status: row.status as TaskStatus, priority: row.priority as TaskPriority,
      dueAt: row.dueAt == null ? null : String(row.dueAt), remindAt: row.remindAt == null ? null : String(row.remindAt),
      reminderFiredAt: row.reminderFiredAt == null ? null : String(row.reminderFiredAt), sourceConversationId: row.sourceConversationId == null ? null : String(row.sourceConversationId),
      createdAt: String(row.createdAt), updatedAt: String(row.updatedAt),
    };
  }

}
