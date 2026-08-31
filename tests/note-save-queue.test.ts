import assert from 'node:assert/strict';
import test from 'node:test';
import { NoteSaveQueue, clearNoteDraft, noteDraftKey, noteSaveStatus, readNoteDraft, saveNoteDraft, type NoteSaveSnapshot } from '../frontend/src/features/notes/note-save-queue';
import type { Note } from '../frontend/src/contracts/desktop-bridge';

const snapshot = (content: string): NoteSaveSnapshot => ({ title: '页面', content, icon: null, cover: null, properties: { status: null, date: null, tags: [] } });
const saved = (id: string, content: string): Note => ({ id, ...snapshot(content), parentId: null, position: 0, archived: false, favorite: false, lastOpenedAt: null, createdAt: '', updatedAt: '' });

test('serializes one note and never acknowledges an obsolete response', async () => {
  const requests: Array<{ content: string; resolve: (note: Note) => void }> = [];
  const acknowledged: string[] = [];
  const queue = new NoteSaveQueue({ save: async (id, value) => new Promise<Note>((resolve) => requests.push({ content: value.content, resolve: () => resolve(saved(id, value.content)) })), onSaved: (note) => acknowledged.push(note.content) });

  queue.enqueue('note-a', snapshot('v1'));
  queue.enqueue('note-a', snapshot('v2'));
  assert.deepEqual(requests.map((request) => request.content), ['v1']);
  requests[0].resolve(saved('note-a', 'v1'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(requests.map((request) => request.content), ['v1', 'v2']);
  assert.deepEqual(acknowledged, []);
  requests[1].resolve(saved('note-a', 'v2'));
  await queue.flush('note-a');
  assert.deepEqual(acknowledged, ['v2']);
});

test('retains failed content and retries it explicitly', async () => {
  let attempts = 0;
  const acknowledged: string[] = [];
  const queue = new NoteSaveQueue({ save: async (id, value) => { attempts += 1; if (attempts === 1) throw new Error('offline'); return saved(id, value.content); }, onSaved: (note) => acknowledged.push(note.content) });
  queue.enqueue('note-a', snapshot('pending'));
  await queue.flush('note-a');
  assert.equal(queue.hasPending('note-a'), true);
  queue.retry('note-a');
  await queue.flush('note-a');
  assert.equal(queue.hasPending('note-a'), false);
  assert.deepEqual(acknowledged, ['pending']);
});

test('keeps saves for different notes independent', async () => {
  const requests: string[] = [];
  const queue = new NoteSaveQueue({ save: async (id, value) => { requests.push(`${id}:${value.content}`); return saved(id, value.content); } });
  queue.enqueue('note-a', snapshot('a'));
  queue.enqueue('note-b', snapshot('b'));
  await queue.flush();
  assert.deepEqual(requests.sort(), ['note-a:a', 'note-b:b']);
});

test('stores drafts by note identity and ignores malformed drafts', () => {
  const values = new Map<string, string>();
  const storage = {
    setItem: (key: string, value: string) => values.set(key, value),
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
  };
  saveNoteDraft(storage, 'note-a', snapshot('draft'));
  assert.deepEqual(readNoteDraft(storage, 'note-a'), snapshot('draft'));
  assert.equal(values.has(noteDraftKey('note-a')), true);
  values.set(noteDraftKey('note-b'), '{bad');
  assert.equal(readNoteDraft(storage, 'note-b'), null);
  clearNoteDraft(storage, 'note-a');
  assert.equal(readNoteDraft(storage, 'note-a'), null);
});

test('projects a failed save distinctly while retaining pending content for retry', () => {
  assert.equal(noteSaveStatus(false, false), 'saved');
  assert.equal(noteSaveStatus(true, false), 'saving');
  assert.equal(noteSaveStatus(true, true), 'failed');
  assert.equal(noteSaveStatus(false, true), 'failed');
});
