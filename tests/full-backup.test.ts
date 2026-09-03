import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppStore } from '../electron/store';
import { createFullBackup, restoreFullBackup } from '../electron/full-backup';
import { TaskAssetStore } from '../electron/task-assets';
import { BrowserArtifactStore } from '../electron/browser-artifacts';
import { NoteCoverStore } from '../electron/note-covers';

test('full backup round-trips database data and explicitly supplied provider keys', async () => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-full-source-'));
  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-full-target-'));
  const source = new AppStore(sourceDir); const target = new AppStore(targetDir);
  try {
    const conversation = source.createConversation();
    source.addMessage(conversation.id, 'user', '完整备份');
    source.saveConversationCapabilities(conversation.id, { browserUse: 'disabled', computerUse: 'enabled' });
    source.saveDesktopPresenceConfig({ notificationsEnabled: false, menuBarEnabled: false });
    source.saveDesktopPetConfig({ enabled: true, petId: 'demo', scale: 1.1 });
    fs.mkdirSync(path.join(sourceDir, 'workspace'), { recursive: true }); fs.writeFileSync(path.join(sourceDir, 'workspace', 'secret.txt'), 'do not include');
    fs.mkdirSync(path.join(sourceDir, 'task-assets'), { recursive: true }); fs.writeFileSync(path.join(sourceDir, 'task-assets', 'asset.txt'), 'asset');
    fs.writeFileSync(path.join(sourceDir, 'secrets.json'), 'API-KEY');
    const archive = await createFullBackup({ dataDir: sourceDir, store: source, providerKeys: { default: 'sk-test-secret' }, appVersion: '0.1.4', platform: 'darwin-arm64' });
    assert.equal(archive.includes(Buffer.from('API-KEY')), false);
    assert.equal(archive.includes(Buffer.from('do not include')), false);
      const report = await restoreFullBackup({ dataDir: targetDir, store: target, archive });
      assert.deepEqual(report.providerKeys, { default: 'sk-test-secret' });
    assert.ok(report.conversations >= 1);
    assert.equal(report.contextUnavailable, false);
    assert.deepEqual(target.getDesktopPresenceConfig(), { notificationsEnabled: false, menuBarEnabled: false });
    assert.deepEqual(target.getDesktopPetConfig(), { enabled: true, petId: 'demo', scale: 1.1 });
    const restoredConversation = target.getConversation(report.conversationMap[conversation.id]);
    assert.ok(restoredConversation);
    assert.deepEqual(target.getConversationCapabilities(restoredConversation.id), { browserUse: 'disabled', computerUse: 'enabled' });
    assert.ok(fs.readdirSync(path.join(targetDir, 'task-assets')).length >= 1);
  } finally { source.close(); target.close(); fs.rmSync(sourceDir, { recursive: true, force: true }); fs.rmSync(targetDir, { recursive: true, force: true }); }
});

test('full backup remaps restored task attachment and run artifact URLs to readable files', async () => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-assets-source-'));
  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-assets-target-'));
  const source = new AppStore(sourceDir);
  const target = new AppStore(targetDir);
  try {
    const sourceTaskAssets = new TaskAssetStore(path.join(sourceDir, 'task-assets'));
    const attachment = await sourceTaskAssets.import('brief.txt', 'text/plain', Buffer.from('attachment-body'));
    source.createTask({ title: '含附件任务', description: `[附件](${attachment.url})` });

    const conversation = source.createConversation('含截图会话');
    const input = source.addMessage(conversation.id, 'user', '截图');
    source.startRun('run-with-artifact', conversation.id, input.id);
    source.startToolActivity('run-with-artifact', 'tool-1', 'browser_screenshot');
    const sourceArtifacts = new BrowserArtifactStore(path.join(sourceDir, 'browser-use', 'screenshots'));
    const artifact = sourceArtifacts.saveImage(Buffer.from('screenshot-body').toString('base64'), 'image/png');
    source.addRunArtifact('run-with-artifact', 'tool-1', artifact);
    source.finishToolActivity('run-with-artifact', 'tool-1', 'browser_screenshot', false);
    source.finishRun('run-with-artifact', 'completed');

    const archive = await createFullBackup({ dataDir: sourceDir, store: source, appVersion: '0.2.0', platform: 'darwin-arm64' });
    await restoreFullBackup({ dataDir: targetDir, store: target, archive });

    const importedTask = target.listTaskBoards()
      .flatMap((board) => target.listTasks(board.id))
      .find((task) => task.title === '含附件任务');
    assert.ok(importedTask);
    const taskUrl = importedTask.description.match(/\((yuheng-task-asset:[^)]+)\)/)?.[1];
    assert.ok(taskUrl);
    const targetTaskAssets = new TaskAssetStore(path.join(targetDir, 'task-assets'));
    assert.equal(fs.readFileSync(targetTaskAssets.resolveUrl(taskUrl), 'utf8'), 'attachment-body');
    assert.notEqual(taskUrl, attachment.url);

    const importedConversation = target.listConversations(true).find((item) => item.title === '含截图会话');
    assert.ok(importedConversation);
    const importedArtifact = target.listRuns(importedConversation.id)[0]?.activities[0]?.artifacts[0];
    assert.ok(importedArtifact);
    const targetArtifacts = new BrowserArtifactStore(path.join(targetDir, 'browser-use', 'screenshots'));
    assert.equal(fs.readFileSync(targetArtifacts.resolveUrl(importedArtifact.url), 'utf8'), 'screenshot-body');
    assert.notEqual(importedArtifact.url, artifact.url);
  } finally {
    source.close();
    target.close();
    fs.rmSync(sourceDir, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
});

test('full backup remaps custom note cover files', async () => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-cover-backup-source-'));
  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-cover-backup-target-'));
  const source = new AppStore(sourceDir); const target = new AppStore(targetDir);
  try {
    const cover = new NoteCoverStore(path.join(sourceDir, 'note-covers')).import('cover.jpg', 'image/jpeg', Buffer.from('cover-body'));
    const note = source.createNote('封面页面');
    source.updateNote(note.id, { cover: cover.url });
    const archive = await createFullBackup({ dataDir: sourceDir, store: source, appVersion: '0.2.1', platform: 'darwin-arm64' });
    await restoreFullBackup({ dataDir: targetDir, store: target, archive });
    const restored = target.listNotes().find((item) => item.title === '封面页面');
    assert.ok(restored?.cover);
    assert.notEqual(restored.cover, cover.url);
    const targetCovers = new NoteCoverStore(path.join(targetDir, 'note-covers'));
    assert.equal(fs.readFileSync(targetCovers.resolveUrl(restored.cover!), 'utf8'), 'cover-body');
  } finally { source.close(); target.close(); fs.rmSync(sourceDir, { recursive: true, force: true }); fs.rmSync(targetDir, { recursive: true, force: true }); }
});

test('full backup preserves knowledge bases and remaps page ownership', async () => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-kb-backup-source-'));
  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-kb-backup-target-'));
  const source = new AppStore(sourceDir); const target = new AppStore(targetDir);
  try {
    const sourceBase = source.createKnowledgeBase({ name: '开发知识库', color: '#4f8f8b' });
    const sourceRoot = source.createNoteInKnowledgeBase(sourceBase.id, { title: 'API 规范' });
    const archive = await createFullBackup({ dataDir: sourceDir, store: source, appVersion: '0.4.0', platform: 'darwin-arm64' });
    const report = await restoreFullBackup({ dataDir: targetDir, store: target, archive });
    assert.ok(report.notes >= 1);
    const importedBase = target.listKnowledgeBases().find((base) => base.name === '开发知识库');
    assert.ok(importedBase);
    assert.notEqual(importedBase.id, sourceBase.id);
    const importedRoot = target.listNotesInKnowledgeBase(importedBase.id).find((note) => note.title === 'API 规范');
    assert.ok(importedRoot);
    assert.equal(importedRoot.knowledgeBaseId, importedBase.id);
    assert.equal(target.listNotesInKnowledgeBase(target.getDefaultKnowledgeBase().id).some((note) => note.id === importedRoot.id), false);
    assert.ok(sourceRoot.id);
  } finally { source.close(); target.close(); fs.rmSync(sourceDir, { recursive: true, force: true }); fs.rmSync(targetDir, { recursive: true, force: true }); }
});

test('legacy backup without knowledge base data imports notes into the default knowledge base', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-kb-legacy-backup-'));
  const store = new AppStore(dataDir);
  try {
    const report = store.importFullBackupSnapshot({
      conversationProjects: [], conversations: [], messages: [], runs: [], runActivities: [], runArtifacts: [], providers: [], appSettings: [], taskBoards: [], taskTypes: [], tasks: [],
      notes: [{ id: 'legacy-note', parentId: null, title: '旧页面', content: '内容', position: 0, archived: false, createdAt: '', updatedAt: '' }],
    });
    assert.equal(report.notes, 1);
    const note = store.listNotes().find((item) => item.title === '旧页面');
    assert.equal(note?.knowledgeBaseId, store.getDefaultKnowledgeBase().id);
  } finally { store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
});
