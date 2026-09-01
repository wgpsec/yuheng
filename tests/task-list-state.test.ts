import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Task } from '../frontend/src/contracts/desktop-bridge';
import { mergeTaskChange } from '../frontend/src/features/tasks/task-list-state';

const task = (id: string, status = 'todo', overrides: Partial<Task> = {}): Task => ({
  id,
  boardId: 'board',
  title: id,
  description: '',
  status,
  priority: 'medium',
  dueAt: null,
  remindAt: null,
  reminderFiredAt: null,
  sourceConversationId: null,
  createdAt: '2026-08-31T00:00:00.000Z',
  updatedAt: '2026-08-31T00:00:00.000Z',
  ...overrides,
});

describe('task list state merging', () => {
  it('keeps a task in place when only its content changes', () => {
    const current = [task('a'), task('b')];
    const updated = task('b', 'todo', { title: '更新后的标题', description: '更新后的内容', updatedAt: '2026-08-31T01:00:00.000Z' });

    const result = mergeTaskChange(current, updated, 'board');

    assert.deepEqual(result.map((item) => item.id), ['a', 'b']);
    assert.equal(result[1].title, '更新后的标题');
  });

  it('moves a status-changed task to the end of its target column', () => {
    const current = [task('a', 'todo'), task('b', 'todo'), task('c', 'doing')];
    const result = mergeTaskChange(current, task('a', 'doing'), 'board');

    assert.deepEqual(result.filter((item) => item.status === 'todo').map((item) => item.id), ['b']);
    assert.deepEqual(result.filter((item) => item.status === 'doing').map((item) => item.id), ['c', 'a']);
  });

  it('appends a new task and removes tasks that leave the active board', () => {
    const current = [task('a'), task('b')];
    assert.deepEqual(mergeTaskChange(current, task('c'), 'board').map((item) => item.id), ['a', 'b', 'c']);
    assert.deepEqual(mergeTaskChange(current, { ...task('b'), boardId: 'other' }, 'board').map((item) => item.id), ['a']);
  });
});
