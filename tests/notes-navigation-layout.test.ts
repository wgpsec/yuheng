import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('recent notes and library use the same scrollbar treatment', () => {
  const css = fs.readFileSync(path.join(root, 'frontend/src/styles/shell.css'), 'utf8');
  assert.match(css, /\.notes-quick-list, \.notes-nav-tree \{[^}]*scrollbar-width: thin;[^}]*scrollbar-color: var\(--stroke-default\) transparent;/u);
});

test('long note titles stay within the navigation width and use ellipsis', () => {
  const css = fs.readFileSync(path.join(root, 'frontend/src/styles/shell.css'), 'utf8');
  assert.match(css, /\.notes-nav-tree \{[^}]*overflow-x: hidden;/u);
  assert.match(css, /\.notes-library-group, \.notes-library-row, \.notes-library-pages, \.notes-tree-node, \.notes-tree-children \{[^}]*min-width: 0;[^}]*max-width: 100%;/u);
  assert.match(css, /\.notes-nav-tree \.notes-tree-select span \{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/u);
});
