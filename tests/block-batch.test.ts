import assert from 'node:assert/strict';
import test from 'node:test';
import { Editor } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { blockRangeAt, contiguousBlockRange, copyBlockRangeToClipboard, deleteBlockRange, duplicateBlockRange, moveBlockRange } from '../frontend/src/features/tasks/block-batch';

function editorWith(markdown: string): Editor {
  return new Editor({ extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true }), Markdown], content: markdown, contentType: 'markdown' });
}

test('selects a continuous top-level block range and applies duplicate and delete operations', () => {
  const editor = editorWith('Alpha\n\nBeta\n\nGamma');
  try {
    const first = blockRangeAt(editor.state.doc, 0)!;
    const second = blockRangeAt(editor.state.doc, first.to)!;
    const selected = contiguousBlockRange(editor.state.doc, first.from, second.from)!;
    assert.deepEqual(selected, { from: first.from, to: second.to });

    duplicateBlockRange(editor, selected);
    assert.equal(editor.getMarkdown(), 'Alpha\n\nBeta\n\nAlpha\n\nBeta\n\nGamma');

    deleteBlockRange(editor, selected);
    assert.equal(editor.getMarkdown(), 'Alpha\n\nBeta\n\nGamma');
  } finally {
    editor.destroy();
  }
});

test('moves a selected block range as one unit without changing its internal order', () => {
  const editor = editorWith('Alpha\n\nBeta\n\nGamma');
  try {
    const first = blockRangeAt(editor.state.doc, 0)!;
    const second = blockRangeAt(editor.state.doc, first.to)!;
    const third = blockRangeAt(editor.state.doc, second.to)!;
    moveBlockRange(editor, third, first.from);
    assert.equal(editor.getMarkdown(), 'Gamma\n\nAlpha\n\nBeta');
  } finally {
    editor.destroy();
  }
});

test('copies selected blocks as Markdown without duplicating them in the document', async () => {
  const editor = editorWith('Alpha\n\n- [x] Beta\n\nGamma');
  const writes: string[] = [];
  try {
    const first = blockRangeAt(editor.state.doc, 0)!;
    const second = blockRangeAt(editor.state.doc, first.to)!;
    const selected = contiguousBlockRange(editor.state.doc, first.from, second.from)!;

    await copyBlockRangeToClipboard(editor, selected, {
      writeText: async (value) => { writes.push(value); },
    });

    assert.deepEqual(writes, ['Alpha\n\n- [x] Beta']);
    assert.equal(editor.getMarkdown(), 'Alpha\n\n- [x] Beta\n\nGamma');
  } finally {
    editor.destroy();
  }
});
