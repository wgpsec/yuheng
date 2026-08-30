import { createAtomBlockMarkdownSpec, Node, type NodeViewRenderer } from '@tiptap/core';

export type NotePageNodeOptions = {
  getTitle: (noteId: string) => string | undefined;
  getIcon?: (noteId: string) => string | null | undefined;
  onOpen: (noteId: string) => void;
};

const NOTE_PAGE_BLOCK_PATTERN = /:::yuheng-page\s+\{[^}]*\bnoteId="([^"]+)"[^}]*\}\s*:::/gu;

const markdownSpec = createAtomBlockMarkdownSpec({
  nodeName: 'notePage',
  name: 'yuheng-page',
  requiredAttributes: ['noteId'],
  allowedAttributes: ['noteId'],
});

/** Stable markdown helpers used to keep page blocks in the note body. */
export function notePageBlock(noteId: string): string {
  return `:::yuheng-page {noteId="${noteId}"} :::`;
}

export function referencedNotePageIds(markdown: string): Set<string> {
  const ids = new Set<string>();
  for (const match of markdown.matchAll(NOTE_PAGE_BLOCK_PATTERN)) {
    const id = match[1];
    if (id) ids.add(id);
  }
  return ids;
}

/** Reconcile controlled page blocks without changing the order of valid existing blocks. */
export function ensureNotePageBlocks(markdown: string, childIds: readonly string[]): string {
  const allowed = new Set(childIds);
  const filtered = markdown.replace(NOTE_PAGE_BLOCK_PATTERN, (block, noteId: string) => allowed.has(noteId) ? block : '');
  const normalized = filtered === markdown ? filtered : filtered.trimEnd();
  const referenced = referencedNotePageIds(normalized);
  const missing = childIds.filter((id) => !referenced.has(id));
  if (missing.length === 0) return normalized;
  const suffix = missing.map(notePageBlock).join('\n\n');
  return normalized.trim() ? `${normalized.trimEnd()}\n\n${suffix}` : suffix;
}

function createPageNodeView(options: NotePageNodeOptions): NodeViewRenderer {
  return ({ node }) => {
    const noteId = String(node.attrs.noteId ?? '');
    const dom = document.createElement('button');
    dom.type = 'button';
    dom.className = 'note-page-block';
    dom.dataset.noteId = noteId;
    dom.setAttribute('aria-label', '打开子页面');
    dom.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (noteId) options.onOpen(noteId);
    });

    const icon = document.createElement('span');
    icon.className = 'note-page-block-icon';
    const noteIcon = options.getIcon?.(noteId);
    if (noteIcon) icon.textContent = noteIcon;
    else icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5A2.5 2.5 0 0 1 17.5 21h-11A2.5 2.5 0 0 1 4 18.5v-13Z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M4 6h16M8 10h8M8 14h5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.7"/></svg>';
    const title = document.createElement('span');
    title.className = 'note-page-block-title';
    title.textContent = options.getTitle(noteId) ?? '页面已删除';
    const arrow = document.createElement('span');
    arrow.className = 'note-page-block-arrow';
    arrow.textContent = '›';
    dom.append(icon, title, arrow);

    return {
      dom,
      stopEvent: () => true,
      ignoreMutation: () => true,
    };
  };
}

export const NotePageNode = Node.create<NotePageNodeOptions>({
  name: 'notePage',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  // ProseMirror still needs a schema DOM serializer when a NodeView is
  // detached or the editor state is serialized. Without this fallback,
  // unmounting the editor crashes with `spec.toDOM is not a function`.
  renderHTML({ HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, 'data-note-page': HTMLAttributes.noteId }];
  },
  addOptions() {
    return {
      getTitle: () => undefined,
      getIcon: () => undefined,
      onOpen: () => undefined,
    };
  },
  addAttributes() {
    return {
      noteId: { default: null },
    };
  },
  ...markdownSpec,
  addNodeView() {
    return createPageNodeView(this.options);
  },
});
