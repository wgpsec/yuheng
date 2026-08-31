import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TaskReminderScheduler } from '../electron/task-reminders';
import type { Task } from '../electron/store';
import { TaskPetReminderQueue, taskReminderFeedback } from '../electron/task-pet-reminders';

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
  it('builds a clipped Pet reminder that targets the exact task', () => {
    const feedback = taskReminderFeedback(task({ title: '  这是一个非常非常长的任务标题，需要在宠物气泡里被安全裁剪  ' }));
    assert.equal(feedback.state, 'attention');
    assert.equal(feedback.label, '任务提醒');
    assert.equal(feedback.detail, '这是一个非常非常长的任务标题，需要在宠物气泡里被安全…');
    assert.deepEqual(feedback.openTarget, { kind: 'task', boardId: 'default', taskId: 'task-1' });
  });

  it('queues reminders deterministically, deduplicates tasks, and expires stale entries', () => {
    const queue = new TaskPetReminderQueue({ ttlMs: 1_000 });
    queue.enqueue(task({ id: 'task-b', remindAt: '2026-08-27T08:02:00.000Z' }), 1_000);
    queue.enqueue(task({ id: 'task-a', remindAt: '2026-08-27T08:01:00.000Z' }), 1_000);
    queue.enqueue(task({ id: 'task-a', title: '重复提醒' }), 1_001);
    assert.equal(queue.size(1_500), 2);
    assert.equal(queue.next(1_500)?.id, 'task-a');
    assert.equal(queue.next(1_500)?.id, 'task-b');
    queue.enqueue(task({ id: 'task-c' }), 2_000);
    assert.equal(queue.next(3_001), undefined);
  });

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
