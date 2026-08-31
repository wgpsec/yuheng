import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Task } from '../frontend/src/contracts/desktop-bridge';
import { filterBoardTasks } from '../frontend/src/features/tasks/task-filter';

const task = (overrides: Partial<Task>): Task => ({
  id: overrides.id ?? crypto.randomUUID(), boardId: 'board', title: overrides.title ?? '任务', description: '', status: 'todo', priority: 'medium', dueAt: null, remindAt: null, reminderFiredAt: null, sourceConversationId: null, createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z', ...overrides,
});

describe('task board filtering', () => {
  const tasks = [
    task({ id: 'focus', title: '整理发布计划', description: '准备上线清单', dueAt: '2026-08-27' }),
    task({ id: 'remind', title: '联系客户', remindAt: '2026-08-28T01:00:00.000Z' }),
    task({ id: 'fired', title: '已提醒事项', remindAt: '2026-08-27T01:00:00.000Z', reminderFiredAt: '2026-08-27T01:00:01.000Z' }),
    task({ id: 'done', title: '已完成计划', status: 'board:done', dueAt: '2026-08-26' }),
  ];

  it('searches task titles and Markdown details', () => {
    assert.deepEqual(filterBoardTasks(tasks, '上线清单', 'all').map((item) => item.id), ['focus']);
  });

  it('filters open, due, and pending-reminder work without surfacing closed tasks', () => {
    const now = new Date('2026-08-27T12:00:00+08:00');
    assert.deepEqual(filterBoardTasks(tasks, '', 'open', now).map((item) => item.id), ['focus', 'remind', 'fired']);
    assert.deepEqual(filterBoardTasks(tasks, '', 'due', now).map((item) => item.id), ['focus']);
    assert.deepEqual(filterBoardTasks(tasks, '', 'reminder', now).map((item) => item.id), ['remind']);
  });

  it('filters today tasks across overdue, due, and unfired reminder dates', () => {
    const now = new Date('2026-08-27T12:00:00.000Z');
    const todayTasks = [
      task({ id: 'overdue', dueAt: '2026-08-26T09:00:00.000Z' }),
      task({ id: 'due-today', dueAt: '2026-08-27T09:00:00.000Z' }),
      task({ id: 'reminder-today', remindAt: '2026-08-27T09:00:00.000Z' }),
      task({ id: 'reminder-fired', remindAt: '2026-08-27T09:00:00.000Z', reminderFiredAt: '2026-08-27T10:00:00.000Z' }),
    ];
    assert.deepEqual(filterBoardTasks(todayTasks, '', 'today', now).map((item) => item.id), ['overdue', 'due-today', 'reminder-today']);
  });
});
