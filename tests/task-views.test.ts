import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calendarDays, dateKey, tasksByDueDate } from '../frontend/src/features/tasks/task-views';
import type { Task } from '../frontend/src/contracts/desktop-bridge';

const task = (id: string, dueAt: string | null): Task => ({ id, boardId: 'board', title: id, description: '', status: 'todo', priority: 'medium', dueAt, remindAt: null, reminderFiredAt: null, sourceConversationId: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });

describe('task view projections', () => {
  it('returns a stable six-week calendar and includes adjacent month days', () => {
    const days = calendarDays(new Date(2026, 1, 1));
    assert.equal(days.length, 42);
    assert.equal(days.filter((day) => day.inMonth).length, 28);
    assert.equal(days[0].key, '2026-02-01');
    assert.equal(dateKey(days[41].date), days[41].key);
  });

  it('groups due tasks by their local date and ignores tasks without a due date', () => {
    const grouped = tasksByDueDate([task('a', '2026-02-03'), task('b', '2026-02-03T18:00:00.000Z'), task('c', null)]);
    assert.deepEqual(grouped.get('2026-02-03')?.map((item) => item.id), ['a', 'b']);
    assert.equal(grouped.has('2026-02-04'), false);
  });
});
