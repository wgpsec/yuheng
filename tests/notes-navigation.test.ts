import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NoteTreeItem, parseNotesNavigationSections, runNoteCreation } from '../frontend/src/features/notes/notes-navigation';
import type { NoteTreeNode } from '../frontend/src/features/notes/note-tree';

const noteNode = (overrides: Partial<NoteTreeNode> = {}): NoteTreeNode => ({
  id: 'note-1',
  parentId: null,
  title: '研究资料',
  content: '',
  icon: null,
  cover: null,
  position: 0,
  archived: false,
  favorite: false,
  lastOpenedAt: null,
  createdAt: '2026-08-31T00:00:00.000Z',
  updatedAt: '2026-08-31T00:00:00.000Z',
  children: [],
  ...overrides,
});

describe('Notes sidebar navigation', () => {
  it('restores group expansion while keeping first-use defaults compact', () => {
    assert.deepEqual(parseNotesNavigationSections(null), { favorites: false, recent: false, library: true });
    assert.deepEqual(parseNotesNavigationSections('{"favorites":true,"recent":false,"library":false}'), { favorites: true, recent: false, library: false });
    assert.deepEqual(parseNotesNavigationSections('{broken'), { favorites: false, recent: false, library: true });
  });

  it('exposes direct child-page and page-menu actions for every note row', () => {
    const node = noteNode();
    const html = renderToStaticMarkup(createElement(NoteTreeItem, {
      node,
      activeId: null,
      expanded: {},
      onToggle: () => undefined,
      onSelect: () => undefined,
      onCreateChild: () => undefined,
      onRename: () => undefined,
      onFavorite: () => undefined,
      onArchive: () => undefined,
      onDelete: () => undefined,
      onCopyLink: () => undefined,
      notes: [node],
      onMove: () => undefined,
    }));

    assert.match(html, /aria-label="在研究资料中新建子页面"/);
    assert.match(html, /aria-label="管理研究资料"/);
  });

  it('prevents duplicate page creation and releases admission after completion or failure', async () => {
    const lock = { current: false };
    let resolveFirst: (() => void) | undefined;
    let calls = 0;
    const first = runNoteCreation(lock, async () => {
      calls += 1;
      await new Promise<void>((resolve) => { resolveFirst = resolve; });
    });
    const duplicate = runNoteCreation(lock, async () => { calls += 1; });

    assert.equal(await duplicate, false);
    assert.equal(calls, 1);
    resolveFirst?.();
    assert.equal(await first, true);
    assert.equal(await runNoteCreation(lock, async () => { calls += 1; }), true);
    assert.equal(calls, 2);
    await assert.rejects(runNoteCreation(lock, async () => { calls += 1; throw new Error('offline'); }), /offline/);
    assert.equal(await runNoteCreation(lock, async () => { calls += 1; }), true);
    assert.equal(calls, 4);
  });
});
