import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

describe('Task board card menu styling', () => {
  it('keeps the card width constrained while allowing its menu to escape', () => {
    const css = readFileSync(new URL('../frontend/src/styles/global.css', import.meta.url), 'utf8');
    assert.match(css, /\.task-card-shell\.has-menu\s*\{[^}]*\bz-index:\s*30;[^}]*\bisolation:\s*isolate;/);
    assert.match(css, /\.task-card\s*\{[^}]*\boverflow:\s*hidden\s*;/);
    assert.match(css, /\.task-card-menu\s*\{[^}]*\bz-index:\s*40;/);
  });
});
