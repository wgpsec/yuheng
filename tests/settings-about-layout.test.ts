import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('settings scrolling stays on the right pane while content remains centered', () => {
  const css = fs.readFileSync(path.join(root, 'frontend/src/styles/features/settings.css'), 'utf8');

  assert.match(css, /\.settings-page \{[^}]*width: 100%;[^}]*overflow: auto;/u);
  assert.match(css, /\.settings-page-header,[^{]*\.settings-page > \.settings-section[^{]*\{[^}]*width: min\(724px, 100%\);[^}]*margin-right: auto;[^}]*margin-left: auto;/u);
});

test('settings window keeps a full-width native drag strip above the content', () => {
  const css = fs.readFileSync(path.join(root, 'frontend/src/styles/features/settings.css'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'frontend/src/production/ProductionRenderer.tsx'), 'utf8');

  assert.match(renderer, /className="settings-window-drag-region"/u);
  assert.match(css, /\.settings-window-drag-region \{[^}]*position: absolute;[^}]*inset: 0 0 auto;[^}]*width: 100%;[^}]*height: 48px;[^}]*-webkit-app-region: drag;/u);
});

test('about release rows reserve room for the current-version badge', () => {
  const css = fs.readFileSync(path.join(root, 'frontend/src/styles/features/pet.css'), 'utf8');

  assert.match(css, /\.release-list summary \{[^}]*grid-template-columns: 132px minmax\(0, 1fr\) 18px;/u);
  assert.match(css, /\.release-version \{[^}]*gap: 8px;[^}]*white-space: nowrap;/u);
});
