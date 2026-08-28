import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppStore } from '../electron/store';
import { createFullBackup, restoreFullBackup } from '../electron/full-backup';

test('full backup round-trips database data without secrets', async () => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-full-source-'));
  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-full-target-'));
  const source = new AppStore(sourceDir); const target = new AppStore(targetDir);
  try {
    const conversation = source.createConversation();
    source.addMessage(conversation.id, 'user', '完整备份');
    fs.mkdirSync(path.join(sourceDir, 'workspace'), { recursive: true }); fs.writeFileSync(path.join(sourceDir, 'workspace', 'secret.txt'), 'do not include');
    fs.mkdirSync(path.join(sourceDir, 'task-assets'), { recursive: true }); fs.writeFileSync(path.join(sourceDir, 'task-assets', 'asset.txt'), 'asset');
    fs.writeFileSync(path.join(sourceDir, 'secrets.json'), 'API-KEY');
    const archive = await createFullBackup({ dataDir: sourceDir, store: source, appVersion: '0.1.4', platform: 'darwin-arm64' });
    assert.equal(archive.includes(Buffer.from('API-KEY')), false);
    assert.equal(archive.includes(Buffer.from('do not include')), false);
    const report = await restoreFullBackup({ dataDir: targetDir, store: target, archive });
    assert.ok(report.conversations >= 1);
    assert.equal(report.contextUnavailable, false);
    assert.ok(fs.readdirSync(path.join(targetDir, 'task-assets')).length >= 1);
  } finally { source.close(); target.close(); fs.rmSync(sourceDir, { recursive: true, force: true }); fs.rmSync(targetDir, { recursive: true, force: true }); }
});
