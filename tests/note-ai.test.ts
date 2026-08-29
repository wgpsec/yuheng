import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNoteAiPrompt } from '../frontend/src/features/notes/note-ai';

test('builds explicit prompts for note AI actions and scopes the note context', () => {
  const prompt = buildNoteAiPrompt({ title: '会议记录', content: '决定下周发布。' }, 'summarize');
  assert.match(prompt, /总结/);
  assert.match(prompt, /会议记录/);
  assert.match(prompt, /决定下周发布/);
  assert.match(prompt, /仅基于这篇笔记/);
  assert.match(buildNoteAiPrompt({ title: '草稿', content: '内容' }, 'custom', '改成三条要点'), /改成三条要点/);
});
