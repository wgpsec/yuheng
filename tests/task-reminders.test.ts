import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TaskReminderScheduler } from '../electron/task-reminders';
import type { Task } from '../electron/store';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    boardId: 'default',
    title: '提交发布清单',
    description: '',
    status: 'todo',
    priority: 'medium',
    dueAt: null,
    remindAt: '2026-08-27T08:01:00.000Z',
    reminderFiredAt: null,
    sourceConversationId: null,
    createdAt: '2026-08-27T08:00:00.000Z',
    updatedAt: '2026-08-27T08:00:00.000Z',
    ...overrides,
  };
}

describe('TaskReminderScheduler', () => {
  it('restores a pending reminder, claims it once, and opens the exact task from its notification', () => {
    let now = Date.parse('2026-08-27T08:00:00.000Z');
    let pending = [task()];
    let timer: (() => void) | undefined;
    const notifications: Task[] = [];
    const opened: { boardId: string; taskId: string }[] = [];
    const scheduler = new TaskReminderScheduler({
      listPending: () => pending,
      claim: (id, remindAt) => {
        const found = pending.find((item) => item.id === id && item.remindAt === remindAt);
        if (!found) return null;
        pending = [];
        return { ...found, reminderFiredAt: new Date(now).toISOString() };
      },
      notify: (item, onClick) => { notifications.push(item); onClick(); },
      openTask: (boardId, taskId) => opened.push({ boardId, taskId }),
      now: () => now,
      setTimer: (callback) => { timer = callback; return callback; },
      clearTimer: () => { timer = undefined; },
    });

    scheduler.refresh();
    assert.ok(timer);
    assert.deepEqual(notifications, []);

    now = Date.parse('2026-08-27T08:01:00.000Z');
    timer?.();
    assert.deepEqual(notifications.map((item) => item.id), ['task-1']);
    assert.deepEqual(opened, [{ boardId: 'default', taskId: 'task-1' }]);

    scheduler.refresh();
    assert.deepEqual(notifications.map((item) => item.id), ['task-1']);
  });
});
