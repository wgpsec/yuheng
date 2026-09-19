import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTaskMarkdown, taskDescriptionPreview } from '../frontend/src/features/tasks/task-description';

test('strips trailing empty-paragraph &nbsp; from saved task markdown', () => {
  assert.equal(normalizeTaskMarkdown('任务标题\n\n\n\n&nbsp;'), '任务标题');
  assert.equal(normalizeTaskMarkdown('&nbsp;'), '');
  assert.equal(normalizeTaskMarkdown('\u00a0'), '');
  assert.equal(normalizeTaskMarkdown('hello\n\n&nbsp;\n\nworld'), 'hello\n\n\n\nworld');
});

test('hides empty-paragraph markers from board and list previews', () => {
  assert.equal(taskDescriptionPreview('&nbsp;'), '');
  assert.equal(taskDescriptionPreview('任务标题\n\n\n\n&nbsp;'), '任务标题');
  assert.equal(taskDescriptionPreview('第一段\n\n&nbsp;\n\n第二段'), '第一段\n第二段');
  assert.equal(taskDescriptionPreview('- [x] 完成\n- [ ] 待办'), '☑ 完成\n☐ 待办');
});
