import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { MAX_NOTE_COVER_BYTES, NOTE_COVER_SCHEME, type NoteCoverStore } from '../note-covers';
import type { AppStore, CreateKnowledgeBaseInput, UpdateKnowledgeBaseInput, UpdateNoteInput } from '../store';
import { assertNoteCover, assertText } from './ipc-input';
import type { DomainIpcRegistrar } from './secured-ipc-registrar';

type NoteStore = Pick<AppStore,
  | 'listNotes' | 'listKnowledgeBases' | 'getKnowledgeBase' | 'getDefaultKnowledgeBase' | 'getActiveKnowledgeBaseId' | 'setActiveKnowledgeBaseId' | 'createKnowledgeBase' | 'updateKnowledgeBase' | 'deleteKnowledgeBase' | 'reorderKnowledgeBases'
  | 'listNotesInKnowledgeBase' | 'createNoteInKnowledgeBase' | 'moveNoteToKnowledgeBase' | 'copyNoteToKnowledgeBase' | 'getNote' | 'createNote' | 'updateNote' | 'touchNote' | 'moveNoteBlock'
  | 'moveNote' | 'deleteNote' | 'listNoteVersions' | 'restoreNoteVersion'
>;

export type NoteIpcDependencies = {
  registrar: DomainIpcRegistrar;
  store: NoteStore;
  covers: NoteCoverStore;
  attachmentMimeType(name: string): string;
};

export function registerNoteIpc({ registrar, store, covers, attachmentMimeType }: NoteIpcDependencies): void {
  registrar.main('knowledge-bases:list', (_event, includeArchived: unknown) => store.listKnowledgeBases(includeArchived === true));
  registrar.main('knowledge-bases:get', (_event, id: unknown) => store.getKnowledgeBase(assertText(id, 'knowledgeBaseId')));
  registrar.main('knowledge-bases:default', () => store.getDefaultKnowledgeBase());
  registrar.main('knowledge-bases:active', () => store.getActiveKnowledgeBaseId());
  registrar.main('knowledge-bases:set-active', (_event, id: unknown) => store.setActiveKnowledgeBaseId(assertText(id, 'knowledgeBaseId')));
  registrar.main('knowledge-bases:create', (_event, rawInput: unknown) => {
    if (rawInput === undefined || rawInput === null) return store.createKnowledgeBase();
    if (typeof rawInput !== 'object') throw new Error('Knowledge base input must be an object.');
    const input = rawInput as Record<string, unknown>;
    const payload: CreateKnowledgeBaseInput = {
      ...(input.name === undefined ? {} : { name: assertText(input.name, 'name') }),
      ...(input.icon === undefined ? {} : { icon: input.icon == null ? null : assertText(input.icon, 'icon') }),
      ...(input.color === undefined ? {} : { color: input.color == null ? null : assertText(input.color, 'color') }),
    };
    return store.createKnowledgeBase(payload);
  });
  registrar.main('knowledge-bases:update', (_event, id: unknown, rawPatch: unknown) => {
    if (!rawPatch || typeof rawPatch !== 'object') throw new Error('Knowledge base patch is required.');
    const input = rawPatch as Record<string, unknown>;
    const patch: UpdateKnowledgeBaseInput = {
      ...(input.name === undefined ? {} : { name: assertText(input.name, 'name') }),
      ...(input.icon === undefined ? {} : { icon: input.icon == null ? null : assertText(input.icon, 'icon') }),
      ...(input.color === undefined ? {} : { color: input.color == null ? null : assertText(input.color, 'color') }),
      ...(input.archived === undefined ? {} : { archived: input.archived === true }),
    };
    return store.updateKnowledgeBase(assertText(id, 'knowledgeBaseId'), patch);
  });
  registrar.main('knowledge-bases:delete', (_event, id: unknown) => store.deleteKnowledgeBase(assertText(id, 'knowledgeBaseId')));
  registrar.main('knowledge-bases:reorder', (_event, id: unknown, targetId: unknown) => store.reorderKnowledgeBases(assertText(id, 'knowledgeBaseId'), assertText(targetId, 'targetKnowledgeBaseId')));
  registrar.main('notes:list-in-knowledge-base', (_event, knowledgeBaseId: unknown, includeArchived: unknown) => store.listNotesInKnowledgeBase(assertText(knowledgeBaseId, 'knowledgeBaseId'), includeArchived === true));
  registrar.main('notes:create-in-knowledge-base', (_event, knowledgeBaseId: unknown, rawInput: unknown, parentId: unknown) => {
    const normalizedParentId = parentId == null || parentId === '' ? null : assertText(parentId, 'parentId');
    if (!rawInput || typeof rawInput === 'string') return store.createNoteInKnowledgeBase(assertText(knowledgeBaseId, 'knowledgeBaseId'), typeof rawInput === 'string' ? rawInput : undefined, normalizedParentId);
    if (typeof rawInput !== 'object') throw new Error('Note input must be an object.');
    const input = rawInput as Record<string, unknown>;
    return store.createNoteInKnowledgeBase(assertText(knowledgeBaseId, 'knowledgeBaseId'), {
      ...(input.title === undefined ? {} : { title: assertText(input.title, 'title') }),
      parentId: input.parentId == null ? normalizedParentId : assertText(input.parentId, 'parentId'),
      ...(input.content === undefined ? {} : { content: typeof input.content === 'string' ? input.content : (() => { throw new Error('content must be text.'); })() }),
      ...(input.icon === undefined ? {} : { icon: input.icon == null ? null : assertText(input.icon, 'icon') }),
    });
  });
  registrar.main('notes:move-to-knowledge-base', (_event, id: unknown, knowledgeBaseId: unknown, parentId: unknown, targetId: unknown) => store.moveNoteToKnowledgeBase(assertText(id, 'noteId'), assertText(knowledgeBaseId, 'knowledgeBaseId'), parentId == null || parentId === '' ? null : assertText(parentId, 'parentId'), targetId == null || targetId === '' ? undefined : assertText(targetId, 'targetId')));
  registrar.main('notes:copy-to-knowledge-base', (_event, id: unknown, knowledgeBaseId: unknown, parentId: unknown) => store.copyNoteToKnowledgeBase(assertText(id, 'noteId'), assertText(knowledgeBaseId, 'knowledgeBaseId'), parentId == null || parentId === '' ? null : assertText(parentId, 'parentId')));
  registrar.main('notes:list', (_event, includeArchived: unknown) => store.listNotes(includeArchived === true));
  registrar.main('notes:get', (_event, id: unknown) => store.getNote(assertText(id, 'noteId')));
  registrar.main('notes:create', (_event, rawInput: unknown, parentId: unknown) => {
    const normalizedParentId = parentId == null || parentId === '' ? null : assertText(parentId, 'parentId');
    if (!rawInput || typeof rawInput === 'string') return store.createNote(typeof rawInput === 'string' ? rawInput : undefined, normalizedParentId);
    if (typeof rawInput !== 'object') throw new Error('Note input must be an object.');
    const input = rawInput as Record<string, unknown>;
    return store.createNote({
      ...(input.title === undefined ? {} : { title: assertText(input.title, 'title') }),
      parentId: input.parentId == null ? normalizedParentId : assertText(input.parentId, 'parentId'),
      ...(input.content === undefined ? {} : { content: typeof input.content === 'string' ? input.content : (() => { throw new Error('content must be text.'); })() }),
      ...(input.icon === undefined ? {} : { icon: input.icon == null ? null : assertText(input.icon, 'icon') }),
    });
  });
  registrar.main('notes:update', (_event, id: unknown, rawPatch: unknown) => {
    const noteId = assertText(id, 'noteId');
    if (!rawPatch || typeof rawPatch !== 'object') throw new Error('Note patch is required.');
    const input = rawPatch as Record<string, unknown>;
    const patch: UpdateNoteInput = {
      ...(input.title === undefined ? {} : { title: assertText(input.title, 'title') }),
      ...(input.content === undefined ? {} : { content: typeof input.content === 'string' ? input.content : (() => { throw new Error('content must be text.'); })() }),
      ...(input.archived === undefined ? {} : { archived: input.archived === true }),
      ...(input.icon === undefined ? {} : { icon: input.icon == null ? null : assertText(input.icon, 'icon') }),
      ...(input.cover === undefined ? {} : { cover: input.cover == null ? null : assertNoteCover(input.cover) }),
      ...(input.favorite === undefined ? {} : { favorite: input.favorite === true }),
      ...(input.properties === undefined ? {} : { properties: input.properties && typeof input.properties === 'object' ? input.properties as UpdateNoteInput['properties'] : (() => { throw new Error('properties must be an object.'); })() }),
    };
    const previous = store.getNote(noteId);
    const updated = store.updateNote(noteId, patch);
    if (previous?.cover && previous.cover !== updated.cover && previous.cover.startsWith(`${NOTE_COVER_SCHEME}://`)) covers.remove(previous.cover);
    return updated;
  });
  registrar.main('notes:touch', (_event, id: unknown) => store.touchNote(assertText(id, 'noteId')));
  registrar.main('notes:move-block', (_event, sourceId: unknown, targetId: unknown, sourceContent: unknown, blockMarkdown: unknown) => store.moveNoteBlock(
    assertText(sourceId, 'sourceNoteId'), assertText(targetId, 'targetNoteId'),
    typeof sourceContent === 'string' ? sourceContent : (() => { throw new Error('sourceContent must be text.'); })(),
    assertText(blockMarkdown, 'blockMarkdown'),
  ));
  registrar.main('notes:move', (_event, id: unknown, parentId: unknown, targetId: unknown) => store.moveNote(assertText(id, 'noteId'), parentId == null || parentId === '' ? null : assertText(parentId, 'parentId'), targetId == null || targetId === '' ? undefined : assertText(targetId, 'targetId')));
  registrar.main('notes:delete', (_event, id: unknown) => {
    const noteId = assertText(id, 'noteId');
    const notes = store.listNotes(true);
    const ids = new Set<string>([noteId]);
    let changed = true;
    while (changed) { changed = false; for (const note of notes) if (note.parentId && ids.has(note.parentId) && !ids.has(note.id)) { ids.add(note.id); changed = true; } }
    for (const note of notes) if (ids.has(note.id) && note.cover?.startsWith(`${NOTE_COVER_SCHEME}://`)) covers.remove(note.cover);
    store.deleteNote(noteId);
  });
  registrar.main('notes:covers:pick', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = { properties: ['openFile'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] };
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    if ((await fs.stat(filePath)).size > MAX_NOTE_COVER_BYTES) throw new Error('封面图片不能超过 15 MB。');
    return covers.import(path.basename(filePath), attachmentMimeType(filePath), await fs.readFile(filePath));
  });
  registrar.main('notes:versions:list', (_event, noteId: unknown) => store.listNoteVersions(assertText(noteId, 'noteId')));
  registrar.main('notes:versions:restore', (_event, noteId: unknown, versionId: unknown) => store.restoreNoteVersion(assertText(noteId, 'noteId'), assertText(versionId, 'versionId')));
}
