import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { CODEX_PET_ANIMATIONS, nextCodexPetFrame } from '../frontend/src/production/pet-animation';

describe('Desktop pet dragging', () => {
  it('uses explicit pointer drag IPC instead of relying on a CSS drag region', () => {
    const renderer = readFileSync(new URL('../frontend/src/production/PetRenderer.tsx', import.meta.url), 'utf8');
    const preload = readFileSync(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const main = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../frontend/src/styles/global.css', import.meta.url), 'utf8');
    assert.match(renderer, /onPointerDown=\{startDrag\}/);
    assert.match(renderer, /onPointerMove=\{moveDrag\}/);
    assert.match(renderer, /suppressClickRef/);
    assert.match(renderer, /if \(!drag\.moved\) \{ suppressClickRef\.current = true; void bridge\?\.pet\.focusMain\(\); \}/);
    assert.match(renderer, /onClick=\{handleClick\}/);
    assert.match(preload, /beginDrag: .*pet:drag-start/);
    assert.match(preload, /dragTo: .*pet:drag-move/);
    assert.match(main, /ipcMain\.on\('pet:drag-start'/);
    assert.match(main, /ipcMain\.on\('pet:drag-move'/);
    assert.match(css, /\.desktop-pet\s*\{[^}]*-webkit-app-region:\s*no-drag/);
  });

  it('advances Codex Pet sprites by one complete 192px frame', () => {
    const css = readFileSync(new URL('../frontend/src/styles/global.css', import.meta.url), 'utf8');
    assert.deepEqual(Object.fromEntries(Object.entries(CODEX_PET_ANIMATIONS).map(([state, animation]) => [state, animation.durations.length])), { idle: 6, working: 6, celebrate: 4 });
    for (const state of ['idle', 'working', 'celebrate'] as const) {
      let frame = 0;
      for (let index = 0; index < 100; index += 1) {
        assert.ok(frame >= 0 && frame < CODEX_PET_ANIMATIONS[state].durations.length);
        frame = nextCodexPetFrame(state, frame);
      }
    }
    assert.match(css, /\.desktop-pet-sprite\s*\{[^}]*animation:\s*none/);
  });
});
