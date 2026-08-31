import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export type EditorBlockRange = { from: number; to: number };
export type ClipboardWriter = { writeText(value: string): Promise<void> };

export function blockRangeAt(doc: ProseMirrorNode, position: number): EditorBlockRange | null {
  let match: EditorBlockRange | null = null;
  doc.forEach((node, offset) => {
    if (!match && position >= offset && position < offset + node.nodeSize) match = { from: offset, to: offset + node.nodeSize };
  });
  return match;
}

export function contiguousBlockRange(doc: ProseMirrorNode, anchorPosition: number, currentPosition: number): EditorBlockRange | null {
  const anchor = blockRangeAt(doc, anchorPosition);
  const current = blockRangeAt(doc, currentPosition);
  return anchor && current ? { from: Math.min(anchor.from, current.from), to: Math.max(anchor.to, current.to) } : null;
}

export function duplicateBlockRange(editor: Editor, range: EditorBlockRange): void {
  const content = editor.state.doc.slice(range.from, range.to).content;
  editor.view.dispatch(editor.state.tr.insert(range.to, content));
}

export function blockRangeMarkdown(editor: Editor, range: EditorBlockRange): string {
  if (!editor.markdown) throw new Error('Markdown extension is required to copy blocks.');
  const content = editor.state.doc.slice(range.from, range.to).content.toJSON();
  return editor.markdown.serialize({ type: 'doc', content }).trim();
}

export async function copyBlockRangeToClipboard(editor: Editor, range: EditorBlockRange, clipboard: ClipboardWriter): Promise<void> {
  await clipboard.writeText(blockRangeMarkdown(editor, range));
}

export function deleteBlockRange(editor: Editor, range: EditorBlockRange): void {
  editor.view.dispatch(editor.state.tr.delete(range.from, range.to));
}

export function moveBlockRange(editor: Editor, range: EditorBlockRange, targetPosition: number): void {
  if (targetPosition >= range.from && targetPosition <= range.to) return;
  const content = editor.state.doc.slice(range.from, range.to).content;
  const transaction = editor.state.tr.delete(range.from, range.to);
  transaction.insert(transaction.mapping.map(targetPosition), content);
  editor.view.dispatch(transaction);
}
