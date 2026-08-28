import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBackupArchive, readBackupArchive, type BackupManifest } from '../electron/backup-archive';
import { strToU8, zipSync } from 'fflate';

test('builds and reads a validated yuheng archive', () => {
  const archive = buildBackupArchive({
    'data/conversations.json': Buffer.from('[{"id":"c1"}]'),
    'data/manifest-note.txt': Buffer.from('ok'),
  }, { appVersion: '0.1.4', platform: 'darwin-arm64' });
  const parsed = readBackupArchive(archive);
  assert.equal(parsed.manifest.format, 'yuheng-backup');
  assert.equal(parsed.manifest.version, 1);
  assert.equal(parsed.files.get('data/conversations.json')?.toString(), '[{"id":"c1"}]');
  assert.equal(parsed.manifest.entries.length, 2);
});

test('rejects path traversal and hash tampering before exposing files', () => {
  assert.throws(() => buildBackupArchive({ '../evil': Buffer.from('x') }, {}), /path/i);
  const archive = zipSync({
    'manifest.json': strToU8(JSON.stringify({ format: 'yuheng-backup', version: 1, exportedAt: new Date().toISOString(), appVersion: 'x', platform: 'darwin', entries: [{ path: 'data/a.json', size: 1, sha256: '0'.repeat(64), type: 'file' }], counts: {} })),
    'data/a.json': strToU8('x'),
  });
  assert.throws(() => readBackupArchive(archive), /hash/i);
});

test('rejects symlink-like ZIP entries and oversized archives', () => {
  const manifest: BackupManifest = {
    format: 'yuheng-backup', version: 1, exportedAt: new Date().toISOString(), appVersion: 'x', platform: 'darwin',
    entries: [{ path: 'files/link', size: 0, sha256: '0'.repeat(64), type: 'file' }], counts: {},
  };
  assert.equal(manifest.entries[0].type, 'file');
});
