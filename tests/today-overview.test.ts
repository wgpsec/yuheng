import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { listTodayTasks } from '../frontend/src/features/tasks/today-overview';
import type { Task } from '../frontend/src/contracts/desktop-bridge';

const task = (overrides: Partial<Task>): Task => ({
  id: overrides.id ?? crypto.randomUUID(), boardId: 'board', title: overrides.title ?? '任务', description: '', status: 'todo', priority: 'medium', dueAt: null, remindAt: null, reminderFiredAt: null, sourceConversationId: null, createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z', ...overrides,
});

describe('today task overview', () => {
  it('filters closed tasks and prioritizes overdue, due today, then reminders', () => {
    const items = listTodayTasks([
      task({ id: 'reminder', title: '提醒', remindAt: '2026-08-27T09:00:00.000Z' }),
      task({ id: 'due', title: '到期', dueAt: '2026-08-27' }),
      task({ id: 'late', title: '逾期', dueAt: '2026-08-26' }),
      task({ id: 'done', status: 'board:done', dueAt: '2026-08-26' }),
      task({ id: 'fired', remindAt: '2026-08-27T08:00:00.000Z', reminderFiredAt: '2026-08-27T08:01:00.000Z' }),
    ], new Date('2026-08-27T12:00:00.000+08:00'));
    assert.deepEqual(items.map(({ task: item, kind }) => [item.id, kind]), [['late', 'overdue'], ['due', 'due_today'], ['reminder', 'reminder_today']]);
  });
});
