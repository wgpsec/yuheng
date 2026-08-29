import assert from 'node:assert/strict';
import test from 'node:test';
import { taskDraftFromNote } from '../frontend/src/features/notes/task-from-note';

test('creates a task draft from a note without mutating its markdown', () => {
  const note = { id: 'n1', title: '发布清单', content: '- 检查回滚\n- 通知团队' };
  assert.deepEqual(taskDraftFromNote(note), { title: '发布清单', description: '- 检查回滚\n- 通知团队' });
  assert.deepEqual(taskDraftFromNote({ ...note, title: '   ', content: '' }), { title: '未命名任务', description: '' });
});
