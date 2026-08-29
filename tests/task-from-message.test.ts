import test from 'node:test';
import assert from 'node:assert/strict';
import { taskDraftFromMessage } from '../frontend/src/features/tasks/task-from-message';

test('creates a task draft from a conversation message', () => {
  const draft = taskDraftFromMessage('  跟进供应商\n确认合同和交付时间  ');
  assert.deepEqual(draft, { title: '跟进供应商 确认合同和交付时间', description: '跟进供应商\n确认合同和交付时间' });
});
