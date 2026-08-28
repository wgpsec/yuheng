import test from 'node:test';
import assert from 'node:assert/strict';
import { trayReminderTitle } from '../electron/tray-state';

test('formats the menu bar reminder count', () => {
  assert.equal(trayReminderTitle(0), '');
  assert.equal(trayReminderTitle(2), '2');
  assert.equal(trayReminderTitle(100), '99+');
});
