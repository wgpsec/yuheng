import assert from 'node:assert/strict';
import test from 'node:test';
import { localDateMention, parseTaskMentionHref, taskMentionHref } from '../frontend/src/features/notes/note-mentions';

test('keeps task mentions on an internal board and task identity', () => {
  const href = taskMentionHref('board/研发', 'task 1');
  assert.equal(href, 'yuheng-task://board%2F%E7%A0%94%E5%8F%91/task%201');
  assert.deepEqual(parseTaskMentionHref(href), { boardId: 'board/研发', taskId: 'task 1' });
  assert.equal(parseTaskMentionHref('https://example.com'), null);
  assert.equal(parseTaskMentionHref('yuheng-task://missing-task'), null);
});

test('formats today and tomorrow from local calendar fields', () => {
  const now = new Date(2026, 7, 31, 23, 30);
  assert.equal(localDateMention(now, 0), '2026-08-31');
  assert.equal(localDateMention(now, 1), '2026-09-01');
});
