import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILT_IN_NOTE_COVERS, builtInNoteCover, noteCoverBackgroundStyle, randomNoteCover } from '../frontend/src/features/notes/note-covers';

test('provides stable built-in note covers and avoids immediately repeating one', () => {
  assert.ok(BUILT_IN_NOTE_COVERS.length >= 6);
  assert.equal(builtInNoteCover('missing'), null);
  assert.notEqual(randomNoteCover('aurora', () => 0).id, 'aurora');
  assert.ok(BUILT_IN_NOTE_COVERS.some((cover) => cover.id === randomNoteCover(undefined, () => 0.99).id));
  const coverImages = BUILT_IN_NOTE_COVERS.flatMap((cover) => cover.image ? [cover.image] : []);
  assert.equal(new Set(coverImages).size, coverImages.length);
});

test('builds cover styles without mixing background shorthand and longhand properties', () => {
  const builtIn = BUILT_IN_NOTE_COVERS[0];
  assert.deepEqual(noteCoverBackgroundStyle(builtIn.background, builtIn.image), {
    backgroundImage: `url(${builtIn.image}), ${builtIn.background}`,
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
