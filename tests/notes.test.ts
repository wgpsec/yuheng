import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
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

test('records visible note revisions and restores one without losing the current version', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-note-history-'));
  const store = new AppStore(dataDir);
  try {
    const note = store.createNote({ title: '计划', content: '第一版' });
    store.updateNote(note.id, { content: '第二版' });
    store.updateNote(note.id, { favorite: true });
    store.updateNote(note.id, { content: '第二版' });
    const versions = store.listNoteVersions(note.id);
    assert.equal(versions.length, 1);
    assert.equal(versions[0]?.content, '第一版');

    const restored = store.restoreNoteVersion(note.id, versions[0]!.id);
    assert.equal(restored.content, '第一版');
    assert.equal(store.listNoteVersions(note.id)[0]?.content, '第二版');
  } finally {
    store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('normalizes lightweight properties and includes them in history restoration', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-note-properties-'));
  const store = new AppStore(dataDir);
  try {
    const note = store.createNote('路线图');
    const updated = store.updateNote(note.id, { properties: { status: ' 进行中 ', date: '2026-09-01', tags: [' 产品 ', '产品', '', 'Roadmap'] } });
    assert.deepEqual(updated.properties, { status: '进行中', date: '2026-09-01', tags: ['产品', 'Roadmap'] });
    const version = store.listNoteVersions(note.id)[0]!;
    assert.deepEqual(version.properties, { status: null, date: null, tags: [] });
    assert.deepEqual(store.restoreNoteVersion(note.id, version.id).properties, { status: null, date: null, tags: [] });
    assert.deepEqual(store.listNoteVersions(note.id)[0]?.properties, updated.properties);
  } finally {
    store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('bounds page history and rejects a version owned by another page', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-note-history-boundary-'));
  const store = new AppStore(dataDir);
  try {
    const first = store.createNote({ title: '第一篇', content: 'v0' });
    const second = store.createNote({ title: '第二篇', content: 'other' });
    for (let index = 1; index <= 55; index += 1) store.updateNote(first.id, { content: `v${index}` });
    const versions = store.listNoteVersions(first.id);
    assert.equal(versions.length, 50);
    assert.equal(versions.some((version) => version.content === 'v0'), false);
    const foreignVersion = store.updateNote(second.id, { content: 'changed' }) && store.listNoteVersions(second.id)[0]!;
    assert.throws(() => store.restoreNoteVersion(first.id, foreignVersion.id), /version not found/i);
    assert.equal(store.getNote(first.id)?.content, 'v55');
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

test('creates a note from a template payload in one write', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-notes-template-'));
  const store = new AppStore(dataDir);
  try {
    const parent = store.createNote('项目');
    const note = store.createNote({ title: '会议记录', parentId: parent.id, icon: '🗓️', content: '## 议题\n\n- [ ] 跟进' });
    assert.equal(note.parentId, parent.id);
    assert.equal(note.icon, '🗓️');
    assert.equal(note.content, '## 议题\n\n- [ ] 跟进');
  } finally {
    store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('moves a markdown block between notes atomically', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-notes-block-move-'));
  const store = new AppStore(dataDir);
  try {
    const source = store.createNote({ title: '来源', content: '保留内容\n\n待移动内容' });
    const target = store.createNote({ title: '目标', content: '目标内容' });
    const moved = store.moveNoteBlock(source.id, target.id, '保留内容', '待移动内容');
    assert.equal(moved.source.content, '保留内容');
    assert.equal(moved.target.content, '目标内容\n\n待移动内容');
    assert.throws(() => store.moveNoteBlock(source.id, 'missing', '', '不应丢失'), /not found/i);
    assert.equal(store.getNote(source.id)?.content, '保留内容');
  } finally {
    store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('persists note favorites and only updates recency through explicit touch', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-notes-navigation-'));
  let store = new AppStore(dataDir);
  try {
    const first = store.createNote('常用页面');
    const second = store.createNote('最近页面');
    assert.equal(store.getNote(first.id)?.lastOpenedAt, null);
    store.listNotes();
    assert.equal(store.getNote(first.id)?.lastOpenedAt, null);
    const favorite = store.updateNote(first.id, { favorite: true });
    assert.equal(favorite.favorite, true);
    const touched = store.touchNote(second.id);
    assert.ok(touched.lastOpenedAt);
    const quickNotes = store.search('').filter((result) => result.kind === 'note');
    assert.equal(quickNotes[0]?.id, first.id);
    store.close();
    store = new AppStore(dataDir);
    assert.equal(store.getNote(first.id)?.favorite, true);
    assert.equal(store.getNote(second.id)?.lastOpenedAt, touched.lastOpenedAt);
  } finally {
    store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('migrates legacy note tables without losing pages', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-notes-legacy-'));
  const database = new DatabaseSync(path.join(dataDir, 'yuheng.sqlite'));
  database.exec('CREATE TABLE notes (id TEXT PRIMARY KEY, parent_id TEXT, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT \'\', position INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)');
  database.prepare('INSERT INTO notes (id, parent_id, title, content, position, archived, created_at, updated_at) VALUES (?, NULL, ?, ?, 0, 0, ?, ?)').run('legacy-note', '历史页面', '保留正文', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
  database.close();
  const store = new AppStore(dataDir);
  try {
    const note = store.getNote('legacy-note');
    assert.equal(note?.content, '保留正文');
    assert.equal(note?.favorite, false);
    assert.equal(note?.lastOpenedAt, null);
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
    source.updateNote(child.id, { content: '保留这段内容', favorite: true, properties: { status: '已确认', date: '2026-09-02', tags: ['决策'] } });
    source.touchNote(child.id);
    const snapshot = source.exportFullBackupSnapshot();
    assert.equal(snapshot.notes?.length, 2);
    assert.equal(snapshot.noteVersions?.length, 1);

    const report = target.importFullBackupSnapshot(snapshot);
    assert.equal(report.notes, 2);
    const imported = target.listNotes();
    assert.deepEqual(imported.map((note) => note.title), ['项目笔记', '决策记录']);
    assert.notEqual(imported[0]?.id, root.id);
    assert.equal(imported[1]?.parentId, imported[0]?.id);
    assert.equal(imported[1]?.content, '保留这段内容');
    assert.equal(imported[1]?.favorite, true);
    assert.deepEqual(imported[1]?.properties, { status: '已确认', date: '2026-09-02', tags: ['决策'] });
    assert.ok(imported[1]?.lastOpenedAt);
    assert.equal(target.listNoteVersions(imported[1]!.id)[0]?.content, '');
    assert.deepEqual(target.listNoteVersions(imported[1]!.id)[0]?.properties, { status: null, date: null, tags: [] });
  } finally {
    source.close();
    target.close();
    fs.rmSync(sourceDir, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
});

test('remaps internal note links when restoring a backup with fresh note identities', () => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-notes-links-source-'));
  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-notes-links-target-'));
  const source = new AppStore(sourceDir); const target = new AppStore(targetDir);
  try {
    const sourceA = source.createNote('来源');
    const sourceB = source.createNote('目标');
    source.updateNote(sourceA.id, { content: `[目标](yuheng-note://${sourceB.id})\n\n[外部](yuheng-note://missing)` });
    const report = target.importFullBackupSnapshot(source.exportFullBackupSnapshot());
    assert.equal(report.notes, 2);
    const imported = target.listNotes();
    const importedA = imported.find((note) => note.title === '来源')!;
    const importedB = imported.find((note) => note.title === '目标')!;
    assert.match(importedA.content, new RegExp(`yuheng-note://${importedB.id}`));
    assert.doesNotMatch(importedA.content, new RegExp(`yuheng-note://${sourceB.id}`));
    assert.match(importedA.content, /yuheng-note:\/\/missing/);
  } finally {
    source.close(); target.close();
    fs.rmSync(sourceDir, { recursive: true, force: true }); fs.rmSync(targetDir, { recursive: true, force: true });
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
