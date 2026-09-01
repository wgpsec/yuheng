import assert from 'node:assert/strict';
import test from 'node:test';
import { Editor } from '@tiptap/core';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import { TableKit } from '@tiptap/extension-table';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { Callout, calloutBlock, detailsBlock, EnhancedCodeBlock, ResizableImage } from '../frontend/src/features/tasks/editor-blocks';

test('builds schema-valid callout and details block payloads', () => {
  assert.deepEqual(calloutBlock('warning').attrs, { kind: 'warning' });
  assert.equal(detailsBlock().content?.[0]?.type, 'detailsSummary');
  assert.equal(detailsBlock().content?.[1]?.type, 'detailsContent');
});

test('round-trips enhanced note blocks through markdown', () => {
  const markdown = ':::details\n\n:::detailsSummary\n折叠标题\n:::\n\n:::detailsContent\n\n折叠正文\n\n:::\n\n:::\n\n:::callout {kind="warning"}\n\n重要提醒\n\n:::\n\n| 名称 | 状态 |\n| --- | --- |\n| 玉衡 | 完成 |\n\n```typescript\nconst ok = true\n```';
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ codeBlock: false }), EnhancedCodeBlock,
      Details, DetailsSummary, DetailsContent,
      TableKit.configure({ table: {}, tableCell: {}, tableHeader: {}, tableRow: {} }), Callout, Markdown,
    ],
    content: markdown,
    contentType: 'markdown',
  });
  try {
    assert.deepEqual(editor.getJSON().content?.map((node) => node.type), ['details', 'callout', 'table', 'codeBlock']);
    assert.match(editor.getMarkdown(), /:::callout \{kind="warning"\}/);
    assert.match(editor.getMarkdown(), /\| 玉衡\s+\| 完成/);
    assert.match(editor.getMarkdown(), /```typescript/);
  } finally { editor.destroy(); }
});

test('round-trips resizable image dimensions without changing legacy images', () => {
  assert.deepEqual(ResizableImage.options.resize, {
    enabled: true, directions: ['left', 'right'], minWidth: 120, minHeight: 60, alwaysPreserveAspectRatio: true,
  });
  const legacy = '![image.png](yuheng-task-asset://local/legacy.png "image.png")';
  const resized = '![diagram.png](yuheng-task-asset://local/resized.png "diagram.png"){width=420 height=210}';
  const editor = new Editor({
    extensions: [StarterKit, ResizableImage, Markdown],
    content: `${legacy}\n\n${resized}`,
    contentType: 'markdown',
  });
  try {
    const images = editor.getJSON().content?.filter((node) => node.type === 'image') ?? [];
    assert.deepEqual({ ...images[0]?.attrs }, {
      src: 'yuheng-task-asset://local/legacy.png', alt: 'image.png', title: 'image.png', width: null, height: null,
    });
    assert.deepEqual({ ...images[1]?.attrs }, {
      src: 'yuheng-task-asset://local/resized.png', alt: 'diagram.png', title: 'diagram.png', width: 420, height: 210,
    });
    assert.equal(editor.getMarkdown(), `${legacy}\n\n${resized}`);
  } finally { editor.destroy(); }
});
