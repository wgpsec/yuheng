import assert from 'node:assert/strict';
import test from 'node:test';
import { Editor } from '@tiptap/core';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import { TableKit } from '@tiptap/extension-table';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { Callout, calloutBlock, detailsBlock, EnhancedCodeBlock } from '../frontend/src/features/tasks/editor-blocks';

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
