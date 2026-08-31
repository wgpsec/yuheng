import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILT_IN_NOTE_COVERS, builtInNoteCover, noteCoverBackgroundStyle, randomNoteCover } from '../frontend/src/features/notes/note-covers';

test('provides stable built-in note covers and avoids immediately repeating one', () => {
  assert.ok(BUILT_IN_NOTE_COVERS.length >= 6);
  assert.equal(builtInNoteCover('missing'), null);
  assert.notEqual(randomNoteCover('aurora', () => 0).id, 'aurora');
  assert.ok(BUILT_IN_NOTE_COVERS.some((cover) => cover.id === randomNoteCover(undefined, () => 0.99).id));
});

test('builds non-repeating cover styles for built-in and custom images', () => {
  const builtIn = BUILT_IN_NOTE_COVERS[0];
  assert.deepEqual(noteCoverBackgroundStyle(builtIn.background, builtIn.image), {
    background: builtIn.background,
    backgroundImage: `url(${builtIn.image})`,
    backgroundPosition: 'center',
    backgroundSize: 'cover',
    backgroundRepeat: 'no-repeat',
  });
  assert.deepEqual(noteCoverBackgroundStyle(undefined, 'file:///tmp/custom.webp'), {
    backgroundImage: 'url(file:///tmp/custom.webp)',
    backgroundPosition: 'center',
    backgroundSize: 'cover',
    backgroundRepeat: 'no-repeat',
  });
});
