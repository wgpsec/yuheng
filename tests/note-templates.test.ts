import assert from 'node:assert/strict';
import test from 'node:test';
import { getNoteTemplate, NOTE_TEMPLATES } from '../frontend/src/features/notes/note-templates';

test('note templates provide stable unique presets and a blank fallback', () => {
  assert.equal(new Set(NOTE_TEMPLATES.map((template) => template.id)).size, NOTE_TEMPLATES.length);
  assert.equal(getNoteTemplate('blank').content, '');
  assert.equal(getNoteTemplate('meeting').content.includes('## 后续行动'), true);
  assert.equal(getNoteTemplate('technical').content.includes('```'), true);
});
