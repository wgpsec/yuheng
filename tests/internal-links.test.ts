import assert from 'node:assert/strict';
import test from 'node:test';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { find } from 'linkifyjs';
import { YuhengLink } from '../frontend/src/features/tasks/internal-links';

const createEditor = () => new Editor({
  extensions: [StarterKit.configure({ link: false }), YuhengLink],
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
});

test('keeps Yuheng protocols initialized across concurrent editor lifecycles', () => {
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  const first = createEditor();
  const second = createEditor();
  try {
    assert.equal(find('yuheng-task://board/task')[0]?.href, 'yuheng-task://board/task');
    first.destroy();
    assert.equal(find('yuheng-note://note-id')[0]?.href, 'yuheng-note://note-id');
    assert.deepEqual(warnings, []);
  } finally {
    console.warn = originalWarn;
    if (!first.isDestroyed) first.destroy();
    second.destroy();
  }
});
