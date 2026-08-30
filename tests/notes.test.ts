import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AppStore } from '../electron/store';
import { NoteCoverStore } from '../electron/note-covers';

test('creates and persists a note tree with editable markdown content', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-notes-'));
  let store = new AppStore(dataDir);
  try {
    const root = store.createNote('研究资料');
    const child = store.createNote('会议记录', root.id);
    assert.equal(root.parentId, null);
    assert.equal(child.parentId, root.id);
    assert.deepEqual(store.listNotes().map((note) => note.title), ['研究资料', '会议记录']);

    const updated = store.updateNote(child.id, { content: '# 决策\n\n- 跟进 API' });
    assert.equal(updated.content, '# 决策\n\n- 跟进 API');
    assert.equal(store.getNote(child.id)?.content, updated.content);

    store.close();
    store = new AppStore(dataDir);
    assert.deepEqual(store.listNotes().map((note) => [note.title, note.parentId, note.content]), [
      ['研究资料', null, ''],
      ['会议记录', root.id, '# 决策\n\n- 跟进 API'],
    ]);
  } finally {
    store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('persists note icon and cover metadata and includes it in backups', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-notes-decoration-'));
  let store = new AppStore(dataDir);
  try {
    const note = store.createNote('带装饰的页面');
    const updated = store.updateNote(note.id, { icon: '📚', cover: 'landscape-03' });
    assert.equal(updated.icon, '📚');
    assert.equal(updated.cover, 'landscape-03');
    store.close();
    store = new AppStore(dataDir);
    assert.equal(store.getNote(note.id)?.icon, '📚');
    assert.equal(store.getNote(note.id)?.cover, 'landscape-03');
    assert.equal(store.exportFullBackupSnapshot().notes?.[0]?.cover, 'landscape-03');
    assert.equal(store.updateNote(note.id, { cover: 'https://example.com/remote.jpg' }).cover, null);
  } finally {
    store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('stores custom note covers inside the managed directory and rejects unsafe input', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-note-covers-'));
  const covers = new NoteCoverStore(dataDir);
  try {
    const cover = covers.import('banner.png', 'image/png', Buffer.from('png-data'));
    assert.match(cover.url, /^yuheng-note-cover:\/\/local\//);
    assert.equal(fs.readFileSync(covers.resolveUrl(cover.url), 'utf8'), 'png-data');
    assert.throws(() => covers.import('banner.svg', 'image/svg+xml', Buffer.from('svg')), /PNG|JPEG|WebP/);
    assert.throws(() => covers.resolveUrl('yuheng-note-cover://local/../../secrets'), /Invalid/);
    covers.remove(cover.url);
    assert.equal(fs.existsSync(path.join(dataDir, path.basename(new URL(cover.url).pathname))), false);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('creates an untitled child when the parent is supplied separately', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-notes-child-'));
  const store = new AppStore(dataDir);
  try {
    const root = store.createNote('根页面');
    const child = store.createNote(undefined, root.id);
    assert.equal(child.parentId, root.id);
    assert.equal(child.title, '未命名笔记');
  } finally {
    store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('moves notes across parents, reorders siblings, and rejects cycles', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-notes-move-'));
  const store = new AppStore(dataDir);
  try {
    const first = store.createNote('第一篇');
    const second = store.createNote('第二篇');
    const child = store.createNote('子页面', first.id);
    store.createNote('孙页面', child.id);

    assert.throws(() => store.moveNote(first.id, child.id), /descendant|后代/i);

    const moved = store.moveNote(child.id, null, second.id);
    assert.equal(moved.parentId, null);
    assert.deepEqual(store.listNotes().filter((note) => note.parentId === null).map((note) => note.title), ['第一篇', '子页面', '第二篇']);

  } finally {
    store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('archives notes without losing content and deletes a page subtree', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-notes-delete-'));
  const store = new AppStore(dataDir);
  try {
    const root = store.createNote('待归档');
    const child = store.createNote('子页', root.id);
    store.updateNote(root.id, { archived: true });
    assert.equal(store.listNotes().some((note) => note.id === root.id), false);
    assert.equal(store.listNotes().some((note) => note.id === child.id), false);
    assert.equal(store.listNotes(true).find((note) => note.id === root.id)?.archived, true);
    assert.equal(store.getNote(root.id)?.content, '');

    store.deleteNote(root.id);
    assert.equal(store.getNote(root.id), null);
    assert.equal(store.getNote(child.id), null);
  } finally {
    store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('includes notes in full backup snapshots with remapped parent identities', () => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-notes-backup-source-'));
  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-notes-backup-target-'));
  const source = new AppStore(sourceDir);
  const target = new AppStore(targetDir);
  try {
    const root = source.createNote('项目笔记');
    const child = source.createNote('决策记录', root.id);
    source.updateNote(child.id, { content: '保留这段内容' });
    const snapshot = source.exportFullBackupSnapshot();
    assert.equal(snapshot.notes?.length, 2);

    const report = target.importFullBackupSnapshot(snapshot);
    assert.equal(report.notes, 2);
    const imported = target.listNotes();
    assert.deepEqual(imported.map((note) => note.title), ['项目笔记', '决策记录']);
    assert.notEqual(imported[0]?.id, root.id);
    assert.equal(imported[1]?.parentId, imported[0]?.id);
    assert.equal(imported[1]?.content, '保留这段内容');
  } finally {
    source.close();
    target.close();
    fs.rmSync(sourceDir, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
});

test('indexes note titles and markdown content in global search', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-notes-search-'));
  const store = new AppStore(dataDir);
  try {
    const note = store.createNote('发布计划');
    store.updateNote(note.id, { content: '记录灰度发布和回滚步骤' });
    const titleResult = store.search('发布计划').find((result) => result.kind === 'note');
    const contentResult = store.search('灰度发布').find((result) => result.kind === 'note');
    assert.equal(titleResult?.id, note.id);
    assert.equal(contentResult?.id, note.id);
    assert.equal(contentResult?.context, '笔记');
  } finally {
    store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
