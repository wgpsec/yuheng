import { Extension, type Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { BlockSelectionRange } from './block-selection';

export const blockSelectionPluginKey = new PluginKey<DecorationSet>('yuhengBlockSelection');

function decorationsForRange(doc: ProseMirrorNode, range: BlockSelectionRange | null): DecorationSet {
  if (!range) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  doc.forEach((node, offset) => {
    const to = offset + node.nodeSize;
    if (offset >= range.from && to <= range.to) decorations.push(Decoration.node(offset, to, { class: 'is-block-selected' }));
  });
  return DecorationSet.create(doc, decorations);
}

export function createBlockSelectionPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: blockSelectionPluginKey,
    state: {
      init: () => DecorationSet.empty,
      apply: (transaction, current) => {
        const range = transaction.getMeta(blockSelectionPluginKey) as BlockSelectionRange | null | undefined;
        if (range !== undefined) return decorationsForRange(transaction.doc, range);
        return transaction.docChanged ? current.map(transaction.mapping, transaction.doc) : current;
      },
    },
    props: {
      decorations: (state) => blockSelectionPluginKey.getState(state) ?? DecorationSet.empty,
    },
  });
}

export const BlockSelectionDecorations = Extension.create({
  name: 'blockSelectionDecorations',
  addProseMirrorPlugins() {
    return [createBlockSelectionPlugin()];
  },
});

export function updateBlockSelectionDecorations(editor: Editor, range: BlockSelectionRange | null): void {
  editor.view.dispatch(editor.state.tr.setMeta(blockSelectionPluginKey, range));
}
