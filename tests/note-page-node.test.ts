import assert from 'node:assert/strict';
import test from 'node:test';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { ensureNotePageBlocks, notePageBlock, referencedNotePageIds, NotePageNode } from '../frontend/src/features/notes/note-page-node';

test('keeps note page references in markdown and appends only missing children', () => {
  const existing = `${notePageBlock('child-a')}\n\n正文`;
  assert.deepEqual([...referencedNotePageIds(existing)], ['child-a']);
  assert.equal(ensureNotePageBlocks(existing, ['child-a']), existing);
  assert.equal(ensureNotePageBlocks(existing, ['child-a', 'child-b']), `${existing}\n\n${notePageBlock('child-b')}`);
  assert.equal(ensureNotePageBlocks(`${existing}\n\n${notePageBlock('moved-away')}`, ['child-a']), existing);
});

test('note page blocks round-trip through Tiptap markdown as top-level nodes', () => {
  const editor = new Editor({
    extensions: [
      NotePageNode.configure({ getTitle: (id) => id, onOpen: () => undefined }),
      StarterKit,
      Markdown,
    ],
    content: `${notePageBlock('child-a')}\n\n普通段落`,
    contentType: 'markdown',
  });
  try {
    assert.equal(typeof editor.schema.nodes.notePage.spec.toDOM, 'function');
    assert.deepEqual(editor.getJSON().content?.map((node) => node.type), ['notePage', 'paragraph']);
    assert.equal(editor.getMarkdown(), `${notePageBlock('child-a')}\n\n普通段落`);
  } finally {
    editor.destroy();
  }
});
