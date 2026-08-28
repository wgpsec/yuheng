import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

describe('Desktop pet dragging', () => {
  it('uses explicit pointer drag IPC instead of relying on a CSS drag region', () => {
    const renderer = readFileSync(new URL('../frontend/src/production/PetRenderer.tsx', import.meta.url), 'utf8');
    const preload = readFileSync(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const main = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../frontend/src/styles/global.css', import.meta.url), 'utf8');
    assert.match(renderer, /onPointerDown=\{startDrag\}/);
    assert.match(renderer, /onPointerMove=\{moveDrag\}/);
    assert.match(renderer, /suppressClickRef/);
    assert.match(preload, /beginDrag: .*pet:drag-start/);
    assert.match(preload, /dragTo: .*pet:drag-move/);
    assert.match(main, /ipcMain\.on\('pet:drag-start'/);
    assert.match(main, /ipcMain\.on\('pet:drag-move'/);
    assert.match(css, /\.desktop-pet\s*\{[^}]*-webkit-app-region:\s*no-drag/);
  });
});
