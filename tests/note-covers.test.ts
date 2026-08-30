import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILT_IN_NOTE_COVERS, builtInNoteCover, randomNoteCover } from '../frontend/src/features/notes/note-covers';

test('provides stable built-in note covers and avoids immediately repeating one', () => {
  assert.ok(BUILT_IN_NOTE_COVERS.length >= 6);
  assert.equal(builtInNoteCover('missing'), null);
  assert.notEqual(randomNoteCover('aurora', () => 0).id, 'aurora');
  assert.ok(BUILT_IN_NOTE_COVERS.some((cover) => cover.id === randomNoteCover(undefined, () => 0.99).id));
});
