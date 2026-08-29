import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNoteTree, type NoteTreeNode } from '../frontend/src/features/notes/note-tree';

test('builds a stable nested note tree from flat notes', () => {
  const nodes = buildNoteTree([
    { id: 'child-2', parentId: 'root', title: '第二页', content: '', position: 1, archived: false, createdAt: '', updatedAt: '' },
    { id: 'root', parentId: null, title: '根页面', content: '', position: 0, archived: false, createdAt: '', updatedAt: '' },
    { id: 'child-1', parentId: 'root', title: '第一页', content: '', position: 0, archived: false, createdAt: '', updatedAt: '' },
    { id: 'orphan', parentId: 'missing', title: '孤立页', content: '', position: 0, archived: false, createdAt: '', updatedAt: '' },
  ]);
  assert.deepEqual(nodes.map((node) => node.id), ['root', 'orphan']);
  assert.deepEqual(nodes[0]?.children.map((node) => node.id), ['child-1', 'child-2']);
  assert.equal(nodes[1]?.children.length, 0);
});

export type { NoteTreeNode };
