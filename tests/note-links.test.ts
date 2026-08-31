import assert from 'node:assert/strict';
import test from 'node:test';
import { Editor } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { noteLinkHref, noteLinkMarkdown, referencedNoteIds, resolveNotePreview } from '../frontend/src/features/notes/note-links';

test('serializes a note link with a stable identity and parses it for backlinks', () => {
  const source = `${noteLinkMarkdown('项目计划', 'note-project')}\n\n${noteLinkMarkdown('重复引用', 'note-project')}\n\n${noteLinkMarkdown('会议记录', 'note-meeting')}`;
  assert.equal(noteLinkHref('note-project'), 'yuheng-note://note-project');
  assert.deepEqual(referencedNoteIds(source), ['note-project', 'note-meeting']);
});

test('ignores malformed or unrelated links while preserving valid note identities', () => {
  assert.deepEqual(referencedNoteIds('[普通链接](https://example.com) [坏链接](yuheng-note://) [有效](yuheng-note://note-1)'), ['note-1']);
});

test('round-trips note links through the Markdown editor schema', () => {
  const markdown = noteLinkMarkdown('项目计划', 'note-project');
  const editor = new Editor({
    extensions: [StarterKit.configure({ link: { openOnClick: false, protocols: ['yuheng-note'] } }), Markdown],
    content: markdown,
    contentType: 'markdown',
  });
  try {
    assert.equal(editor.getMarkdown(), markdown);
    assert.equal(editor.getJSON().content?.[0]?.content?.[0]?.marks?.[0]?.attrs?.href, noteLinkHref('note-project'));
  } finally {
    editor.destroy();
  }
});

test('opens only available internal pages in side preview', () => {
  const notes = [
    { id: 'available', archived: false },
    { id: 'archived', archived: true },
  ];
  assert.equal(resolveNotePreview(notes, 'available')?.id, 'available');
  assert.equal(resolveNotePreview(notes, 'archived'), null);
  assert.equal(resolveNotePreview(notes, 'missing'), null);
});
