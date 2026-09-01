import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { DatabaseOwner } from '../electron/storage/database';
import { checkDatabaseIntegrity } from '../electron/storage/integrity-check';
import { MigrationRunner } from '../electron/storage/migration-runner';
import { migrations } from '../electron/storage/migrations';
import { hashFile, MigrationBackupStore, type MigrationBackupFaultStage } from '../electron/storage/migration-backup';
import { MigrationAttemptStore } from '../electron/storage/migration-attempt';
import { RecoveryStore } from '../electron/storage/recovery-store';
import { DiagnosticStore } from '../electron/storage/diagnostics';
import { prepareDatabase } from '../electron/storage/database-preparation';
import { createLegacyV1Fixture } from './fixtures/storage-v1';

describe('database integrity checks', () => {
  it('reports foreign-key violations separately from SQLite page integrity', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-integrity-'));
    const owner = DatabaseOwner.open(path.join(dataDir, 'yuheng.sqlite'));
    try {
      new MigrationRunner(owner, migrations, { appVersion: '0.3.2' })
        .migrate({ id: 'snapshot', status: 'verified', sourceVersion: 0, targetVersion: migrations.length, sha256: 'fixture' });
      assert.deepEqual(checkDatabaseIntegrity(owner.database), { ok: true, quickCheck: ['ok'], foreignKeyViolations: [] });

      owner.database.exec('PRAGMA foreign_keys = OFF');
      owner.database.prepare(`INSERT INTO messages (id, conversation_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)`).run('orphan', 'missing-conversation', 'user', 'fixture', '2026-08-31T00:00:00.000Z');
      owner.database.exec('PRAGMA foreign_keys = ON');

      const result = checkDatabaseIntegrity(owner.database);
      assert.equal(result.ok, false);
      assert.deepEqual(result.quickCheck, ['ok']);
      assert.deepEqual(result.foreignKeyViolations, [{ table: 'messages', parent: 'conversations', foreignKeyId: 0 }]);
    } finally {
      owner.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('migration snapshots', () => {
  it('creates a verified raw snapshot that is independent from later database writes', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-snapshot-'));
    const databasePath = createLegacyV1Fixture(dataDir, 'initial');
    const owner = DatabaseOwner.open(databasePath);
    try {
      const backups = new MigrationBackupStore(dataDir, {
        now: () => new Date('2026-08-31T12:00:00.000Z'),
        id: () => 'fixture-id',
      });
      const snapshot = await backups.createSnapshot(owner, { sourceVersion: 1, targetVersion: migrations.length, appVersion: '0.3.2' });
      assert.equal(snapshot.status, 'verified');
      assert.match(snapshot.sha256, /^[a-f0-9]{64}$/u);
      assert.deepEqual(backups.listSnapshots(), [snapshot]);

      owner.database.prepare('UPDATE conversations SET title = ? WHERE id = ?').run('迁移后标题', 'fixture-conversation');
      const snapshotDb = new DatabaseSync(path.join(dataDir, 'recovery', 'snapshots', snapshot.fileName), { readOnly: true });
      try {
        assert.equal(snapshotDb.prepare('SELECT title FROM conversations WHERE id = ?').get('fixture-conversation')?.title, '脱敏会话');
      } finally {
        snapshotDb.close();
      }
    } finally {
      owner.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('keeps the live database unchanged when any snapshot stage fails', async () => {
    const cases: Array<{ stage: MigrationBackupFaultStage; expectedCode: string }> = [
      { stage: 'writable-check', expectedCode: 'storage_unavailable' },
      { stage: 'space-check', expectedCode: 'storage_unavailable' },
      { stage: 'wal-checkpoint', expectedCode: 'snapshot_failed' },
      { stage: 'snapshot-write', expectedCode: 'snapshot_failed' },
      { stage: 'snapshot-verify', expectedCode: 'snapshot_failed' },
      { stage: 'snapshot-fsync', expectedCode: 'snapshot_failed' },
      { stage: 'snapshot-rename', expectedCode: 'snapshot_failed' },
      { stage: 'metadata-write', expectedCode: 'snapshot_failed' },
      { stage: 'metadata-rename', expectedCode: 'snapshot_failed' },
    ];
    for (const fixture of cases) {
      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `yuheng-snapshot-fault-${fixture.stage}-`));
      const databasePath = createLegacyV1Fixture(dataDir, 'initial');
      const owner = DatabaseOwner.open(databasePath);
      try {
        owner.database.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(`before-${fixture.stage}`, 'fixture-conversation');
        owner.database.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
        const before = await hashFile(databasePath);
        const backups = new MigrationBackupStore(dataDir, {
          id: () => 'fixture-id',
          onStage(stage) { if (stage === fixture.stage) throw new Error(`injected ${stage}`); },
        });
        await assert.rejects(
          backups.createSnapshot(owner, { sourceVersion: 1, targetVersion: migrations.length, appVersion: '0.3.2' }),
          (error: unknown) => error instanceof Error && 'code' in error && error.code === fixture.expectedCode,
          fixture.stage,
        );
        owner.database.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
        assert.equal(await hashFile(databasePath), before, fixture.stage);
        assert.deepEqual(backups.listSnapshots(), [], fixture.stage);
      } finally {
        owner.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
      }
    }
  });
});

describe('migration attempt record', () => {
  it('persists an incomplete attempt atomically for the next startup', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-attempt-'));
    try {
      const attempts = new MigrationAttemptStore(dataDir, { now: () => new Date('2026-08-31T12:00:00.000Z'), id: () => 'attempt-id' });
      let attempt = attempts.begin({ appVersion: '0.3.2', sourceVersion: 1, targetVersion: migrations.length });
      attempt = attempts.update(attempt, {
        stage: 'migrating',
        currentMigrationVersion: 2,
        snapshotFileName: '2026-08-31T120000Z-v1-to-v2-fixture.sqlite',
        snapshotSha256: 'a'.repeat(64),
      });

      const reloaded = new MigrationAttemptStore(dataDir).read();
      assert.deepEqual(reloaded, attempt);
      assert.equal(reloaded?.status, 'in_progress');
      const completed = attempts.complete(attempt);
      assert.equal(completed.status, 'completed');
      assert.equal(new MigrationAttemptStore(dataDir).read()?.status, 'completed');
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('snapshot recovery', () => {
  it('isolates the failed database before atomically restoring a verified snapshot', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-restore-'));
    const databasePath = createLegacyV1Fixture(dataDir, 'initial');
    const owner = DatabaseOwner.open(databasePath);
    let snapshot;
    try {
        snapshot = await new MigrationBackupStore(dataDir, {
        now: () => new Date('2026-08-31T12:00:00.000Z'), id: () => 'snapshot-id',
      }).createSnapshot(owner, { sourceVersion: 1, targetVersion: migrations.length, appVersion: '0.3.2' });
      owner.database.prepare('UPDATE conversations SET title = ? WHERE id = ?').run('失败迁移后的标题', 'fixture-conversation');
      owner.database.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    } finally {
      owner.close();
    }

    try {
      const recovery = new RecoveryStore(dataDir, {
        now: () => new Date('2026-08-31T12:05:00.000Z'), id: () => 'failed-id',
      });
      const result = await recovery.restoreSnapshot(snapshot!.id);
      assert.equal(result.status, 'restored');
      assert.equal(result.snapshotId, snapshot!.id);
      assert.equal(result.failedDatabaseDirectory, '2026-08-31T120500Z-failed-id');

      const restored = new DatabaseSync(databasePath, { readOnly: true });
      try {
        assert.equal(restored.prepare('SELECT title FROM conversations WHERE id = ?').get('fixture-conversation')?.title, '脱敏会话');
      } finally {
        restored.close();
      }
      const failed = new DatabaseSync(path.join(dataDir, 'recovery', 'failed', result.failedDatabaseDirectory!, 'yuheng.sqlite'), { readOnly: true });
      try {
        assert.equal(failed.prepare('SELECT title FROM conversations WHERE id = ?').get('fixture-conversation')?.title, '失败迁移后的标题');
      } finally {
        failed.close();
      }
      assert.equal((await recovery.listSnapshots())[0].status, 'restored');
      assert.equal(await hashFile(path.join(dataDir, 'recovery', 'snapshots', snapshot!.fileName)), snapshot!.sha256);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('refuses a tampered snapshot and leaves the formal database untouched', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-restore-tampered-'));
    const databasePath = createLegacyV1Fixture(dataDir, 'initial');
    const owner = DatabaseOwner.open(databasePath);
    let snapshot;
    try {
      snapshot = await new MigrationBackupStore(dataDir, { id: () => 'snapshot-id' })
        .createSnapshot(owner, { sourceVersion: 1, targetVersion: migrations.length, appVersion: '0.3.2' });
    } finally { owner.close(); }
    const snapshotPath = path.join(dataDir, 'recovery', 'snapshots', snapshot!.fileName);
    fs.appendFileSync(snapshotPath, 'tampered');
    try {
      const recovery = new RecoveryStore(dataDir);
      await assert.rejects(recovery.restoreSnapshot(snapshot!.id), /not available|hash verification failed/);
      const db = new DatabaseSync(databasePath, { readOnly: true });
      try { assert.equal(db.prepare('SELECT title FROM conversations WHERE id = ?').get('fixture-conversation')?.title, '脱敏会话'); }
      finally { db.close(); }
      assert.equal(fs.existsSync(path.join(dataDir, 'recovery', 'failed')), false);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('rolls back file isolation when replacement fails', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-restore-fault-'));
    const databasePath = createLegacyV1Fixture(dataDir, 'initial');
    const owner = DatabaseOwner.open(databasePath);
    let snapshot;
    try {
      snapshot = await new MigrationBackupStore(dataDir, { id: () => 'snapshot-id' })
        .createSnapshot(owner, { sourceVersion: 1, targetVersion: migrations.length, appVersion: '0.3.2' });
      owner.database.prepare('UPDATE conversations SET title = ? WHERE id = ?').run('live-data', 'fixture-conversation');
    } finally { owner.close(); }
    try {
      const recovery = new RecoveryStore(dataDir, { onStage: (stage) => { if (stage === 'replace') throw new Error('replace failed'); } });
      await assert.rejects(recovery.restoreSnapshot(snapshot!.id), /replace failed/);
      const db = new DatabaseSync(databasePath, { readOnly: true });
      try { assert.equal(db.prepare('SELECT title FROM conversations WHERE id = ?').get('fixture-conversation')?.title, 'live-data'); }
      finally { db.close(); }
      assert.equal(fs.existsSync(path.join(dataDir, 'recovery', 'failed')), true);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('diagnostic export', () => {
  it('exports only redacted startup facts and never database content or absolute paths', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-diagnostics-'));
    try {
      const diagnostics = new DiagnosticStore(dataDir, {
        now: () => new Date('2026-08-31T12:00:00.000Z'), id: () => 'diagnostic-id',
      });
      diagnostics.record({
        appVersion: '0.3.2', electronVersion: '42.10.1', nodeVersion: '23.11.0', platform: 'darwin', arch: 'arm64',
        stage: 'migrating', code: 'migration_failed', retryable: false, currentVersion: 1, targetVersion: 2,
        ledger: [{ version: 1, name: 'baseline', source: 'adopted' }],
        snapshots: [{ id: 'snapshot-id', status: 'verified', sha256: 'a'.repeat(64), sourceVersion: 1, targetVersion: 2 }],
        integrity: { quickCheck: ['ok'], foreignKeyViolationCount: 0 },
        errorSummary: 'SQLite constraint failed at /Users/private/yuheng.sqlite; secret=do-not-export',
        userMessage: '迁移失败',
      });
      const outputPath = path.join(dataDir, 'diagnostics.zip');
      await diagnostics.export('diagnostic-id', outputPath);
      const report = JSON.parse(fs.readFileSync(outputPath, 'utf8')) as Record<string, unknown>;
      const serialized = JSON.stringify(report);
      assert.equal(report.diagnosticId, 'diagnostic-id');
      assert.doesNotMatch(serialized, /SQLite constraint|do-not-export|\/Users\/private|yuheng\.sqlite/);
      assert.match(serialized, /migration_failed/);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('database preparation', () => {
  it('prepares an empty data directory through snapshot, migration, and verification', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-preparation-empty-'));
    try {
      const result = await prepareDatabase(dataDir, { appVersion: '0.3.2', diagnosticId: () => 'prep-id' });
      assert.equal(result.status, 'ready');
      if (result.status === 'ready') {
        assert.equal(result.sourceVersion, 0);
        assert.equal(result.targetVersion, migrations.length);
        assert.equal(result.snapshot?.status, 'verified');
        result.owner.close();
      }
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('returns a typed recovery result for an integrity failure and closes the owner', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-preparation-corrupt-'));
    try {
      fs.writeFileSync(path.join(dataDir, 'yuheng.sqlite'), Buffer.from('not sqlite'));
      const result = await prepareDatabase(dataDir, { appVersion: '0.3.2', diagnosticId: () => 'corrupt-id' });
      assert.equal(result.status, 'recovery_required');
      if (result.status === 'recovery_required') {
        assert.equal(result.failure.code, 'database_corrupt');
        assert.equal(result.failure.targetVersion, migrations.length);
        assert.equal(result.failure.diagnosticId, 'corrupt-id');
      }
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('refuses a higher schema version without opening normal storage', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-preparation-newer-'));
    try {
      const db = new DatabaseSync(path.join(dataDir, 'yuheng.sqlite'));
      db.exec('PRAGMA user_version = 99');
      db.close();
      const result = await prepareDatabase(dataDir, { appVersion: '0.3.2', diagnosticId: () => 'newer-id' });
      assert.equal(result.status, 'recovery_required');
      if (result.status === 'recovery_required') assert.equal(result.failure.code, 'schema_too_new');
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('recognizes an unfinished attempt before touching the database', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-preparation-interrupted-'));
    try {
      new MigrationAttemptStore(dataDir, { id: () => 'unfinished-id', now: () => new Date('2026-08-31T12:00:00.000Z') })
        .begin({ appVersion: '0.3.2', sourceVersion: 1, targetVersion: migrations.length });
      const result = await prepareDatabase(dataDir, { appVersion: '0.3.2', diagnosticId: () => 'different-id' });
      assert.equal(result.status, 'recovery_required');
      if (result.status === 'recovery_required') {
        assert.equal(result.failure.code, 'interrupted_migration');
        assert.equal(result.failure.diagnosticId, 'unfinished-id');
      }
      assert.equal(fs.existsSync(path.join(dataDir, 'yuheng.sqlite')), false);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
