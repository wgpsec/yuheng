import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { executeTaskTool, type TaskToolService } from '../electron/task-agent-tools';
import { AppStore, type Task } from '../electron/store';

describe('Agent task tools', () => {
  it('lists task identities, creates a sourced task, and moves it without bypassing AppStore', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'yuheng-task-tools-'));
    const changed: Task[] = [];
    const store = new AppStore(root);
    const conversation = store.createConversation('任务工具测试');
    const service: TaskToolService = {
      listBoards: () => store.listTaskBoards(),
      listTypes: (boardId) => store.listTaskTypes(boardId),
      listTasks: (boardId) => store.listTasks(boardId),
      createTask: (boardId, input) => store.createTask(input, boardId),
      updateTask: (taskId, patch) => store.updateTask(taskId, patch),
      taskChanged: (task) => changed.push(task),
    };

    try {
      const boards = await executeTaskTool(service, conversation.id, 'task_list', {});
      const board = boards.boards[0];
      assert.ok(board);

      const inventory = await executeTaskTool(service, conversation.id, 'task_list', { board_id: board.id });
      const doing = inventory.types.find((type) => type.name === '进行中');
      assert.ok(doing);

      const created = await executeTaskTool(service, conversation.id, 'task_create', {
        board_id: board.id,
        title: '准备 0.1.3 发布说明',
        description: '整理任务工具的使用方式。',
        priority: 'high',
        due_date: '2026-08-29',
        remind_at: '2026-08-29T09:00:00+08:00',
      });
      assert.equal(created.task.sourceConversationId, conversation.id);
      assert.equal(store.getTask(created.task.id).priority, 'high');
      assert.equal(store.getTask(created.task.id).remindAt, '2026-08-29T01:00:00.000Z');

      const updated = await executeTaskTool(service, conversation.id, 'task_update', {
        task_id: created.task.id,
        type_id: doing.id,
        description: '补充真实工具调用示例。',
        remind_at: null,
      });
      assert.equal(updated.task.status, doing.id);
      assert.equal(updated.task.description, '补充真实工具调用示例。');
      assert.equal(updated.task.remindAt, null);
      assert.deepEqual(changed.map((task) => task.id), [created.task.id, created.task.id]);
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects empty updates before touching persistence', async () => {
    let updates = 0;
    const service: TaskToolService = {
      listBoards: () => [],
      listTypes: () => [],
      listTasks: () => [],
      createTask: () => { throw new Error('not expected'); },
      updateTask: () => { updates += 1; throw new Error('not expected'); },
      taskChanged: () => undefined,
    };

    await assert.rejects(() => executeTaskTool(service, 'conversation-42', 'task_update', { task_id: 'task-1' }), /至少提供一个要修改的字段/);
    assert.equal(updates, 0);
  });
});
