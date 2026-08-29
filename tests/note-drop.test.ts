import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveNoteDrop } from '../frontend/src/features/notes/note-drop';
import type { Note } from '../frontend/src/contracts/desktop-bridge';

const notes: Note[] = [
  { id: 'root-a', parentId: null, title: 'A', content: '', position: 0, archived: false, createdAt: '', updatedAt: '' },
  { id: 'root-b', parentId: null, title: 'B', content: '', position: 1, archived: false, createdAt: '', updatedAt: '' },
  { id: 'child', parentId: 'root-a', title: 'C', content: '', position: 0, archived: false, createdAt: '', updatedAt: '' },
];

test('resolves note drop placement and prevents descendant cycles', () => {
  assert.deepEqual(resolveNoteDrop(notes, 'child', 'root-b', 'before'), { parentId: null, targetId: 'root-b' });
  assert.deepEqual(resolveNoteDrop(notes, 'root-b', 'root-a', 'inside'), { parentId: 'root-a' });
  assert.deepEqual(resolveNoteDrop(notes, 'root-a', 'root-b', 'after'), { parentId: null });
  assert.equal(resolveNoteDrop(notes, 'root-a', 'child', 'inside'), null);
  assert.equal(resolveNoteDrop(notes, 'root-a', 'root-a', 'before'), null);
});
