import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettingsSection } from '../frontend/src/production/settings-section.ts';

test('settings section input from a click event falls back to provider', () => {
  const clickEvent = { type: 'click', target: {} } as unknown as MouseEvent;
  assert.equal(normalizeSettingsSection(clickEvent), 'provider');
});

test('valid settings sections are preserved', () => {
  assert.equal(normalizeSettingsSection('pet'), 'pet');
  assert.equal(normalizeSettingsSection('about'), 'about');
});
