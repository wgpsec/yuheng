import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SIDEBAR_WIDTH, loadSidebarWidth, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH } from '../frontend/src/production/sidebar-preferences';

test('loads a persisted sidebar width and keeps it within usable bounds', () => {
  assert.equal(loadSidebarWidth({ getItem: () => '318' }), 318);
  assert.equal(loadSidebarWidth({ getItem: () => '900' }), MAX_SIDEBAR_WIDTH);
  assert.equal(loadSidebarWidth({ getItem: () => '80' }), MIN_SIDEBAR_WIDTH);
  assert.equal(loadSidebarWidth({ getItem: () => 'not-a-number' }), DEFAULT_SIDEBAR_WIDTH);
});
