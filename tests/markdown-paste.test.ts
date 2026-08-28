import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldInterpretMarkdownPaste } from '../frontend/src/features/tasks/markdown-block-editor';

test('recognizes pasted Markdown checklists and nested list syntax', () => {
  assert.equal(shouldInterpretMarkdownPaste('- [x] 已完成\n  - [ ] 子任务'), true);
  assert.equal(shouldInterpretMarkdownPaste('普通文本，- 只是句子的一部分'), false);
});
