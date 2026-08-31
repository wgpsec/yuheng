import type { JSONContent } from '@tiptap/core';
import { createBlockMarkdownSpec, mergeAttributes, Node } from '@tiptap/core';
import CodeBlock from '@tiptap/extension-code-block';

export type CalloutKind = 'info' | 'tip' | 'warning';

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() { return { kind: { default: 'info' } }; },
  parseHTML() { return [{ tag: 'aside[data-callout]' }]; },
  renderHTML({ node, HTMLAttributes }) {
    return ['aside', mergeAttributes(HTMLAttributes, { 'data-callout': node.attrs.kind }), 0];
  },
  ...createBlockMarkdownSpec({ nodeName: 'callout', allowedAttributes: ['kind'], defaultAttributes: { kind: 'info' } }),
  addNodeView() {
    return ({ node: initialNode, editor, getPos }) => {
      let node = initialNode;
      const dom = document.createElement('aside');
      dom.className = 'callout-block';
      dom.dataset.callout = node.attrs.kind;
      const kind = document.createElement('select');
      kind.className = 'callout-kind';
      kind.setAttribute('aria-label', '提示块类型');
      for (const [value, label] of [['info', '信息'], ['tip', '提示'], ['warning', '警告']] as const) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        kind.append(option);
      }
      kind.value = node.attrs.kind;
      const content = document.createElement('div');
      content.className = 'callout-content';
      dom.append(kind, content);
      kind.addEventListener('change', () => {
        if (!editor.isEditable || typeof getPos !== 'function') return;
        const position = getPos();
        if (typeof position === 'number') editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, kind: kind.value }));
      });
      return {
        dom,
        contentDOM: content,
        stopEvent: (event) => event.target === kind,
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'callout') return false;
          node = updatedNode;
          kind.value = updatedNode.attrs.kind;
          dom.dataset.callout = updatedNode.attrs.kind;
          return true;
        },
      };
    };
  },
});

export function calloutBlock(kind: CalloutKind = 'info'): JSONContent {
  return { type: 'callout', attrs: { kind }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '输入提示内容' }] }] };
}

export function detailsBlock(): JSONContent {
  return {
    type: 'details',
    content: [
      { type: 'detailsSummary', content: [{ type: 'text', text: '折叠标题' }] },
      { type: 'detailsContent', content: [{ type: 'paragraph', content: [{ type: 'text', text: '输入折叠内容' }] }] },
    ],
  };
}

export const EnhancedCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ({ node: initialNode, editor, getPos }) => {
      let node = initialNode;
      const dom = document.createElement('div');
      dom.className = 'enhanced-code-block';
      const toolbar = document.createElement('div');
      toolbar.className = 'enhanced-code-toolbar';
      const language = document.createElement('input');
      language.value = node.attrs.language ?? '';
      language.placeholder = 'plain text';
      language.setAttribute('aria-label', '代码语言');
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.textContent = '复制';
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      pre.append(code);
      toolbar.append(language, copy);
      dom.append(toolbar, pre);
      language.addEventListener('change', () => {
        if (!editor.isEditable || typeof getPos !== 'function') return;
        const position = getPos();
        if (typeof position === 'number') editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, language: language.value.trim() || null }));
      });
      copy.addEventListener('click', () => {
        void navigator.clipboard.writeText(code.textContent ?? '').then(() => {
          copy.textContent = '已复制';
          window.setTimeout(() => { copy.textContent = '复制'; }, 1200);
        });
      });
      return {
        dom,
        contentDOM: code,
        stopEvent: (event) => toolbar.contains(event.target as globalThis.Node),
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'codeBlock') return false;
          node = updatedNode;
          language.value = updatedNode.attrs.language ?? '';
          return true;
        },
      };
    };
  },
});
