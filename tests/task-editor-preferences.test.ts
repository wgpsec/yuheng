import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTaskEditorWidth } from '../frontend/src/features/tasks/task-board';

test('loads and clamps the task editor width preference', () => {
  const original = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => '900' } });
  try { assert.equal(loadTaskEditorWidth(), 760); }
  finally { if (original === undefined) delete (globalThis as { localStorage?: unknown }).localStorage; else Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: original }); }
});
