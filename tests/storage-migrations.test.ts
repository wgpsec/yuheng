import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { DatabaseOwner } from '../electron/storage/database';
import { MigrationRunner } from '../electron/storage/migration-runner';
import { migrations } from '../electron/storage/migrations';
import { createCanonicalBusinessSchema, validateCanonicalBusinessSchema, validateCanonicalSchema } from '../electron/storage/schema';
import { createLegacyV1Fixture } from './fixtures/storage-v1';

describe('MigrationRunner', () => {
  const targetVersion = migrations.length;

  it('migrates a v3 database to the current schema', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-migration-v3-to-current-'));
    const databasePath = path.join(dataDir, 'yuheng.sqlite');
    const db = new DatabaseSync(databasePath);
    try {
      createCanonicalBusinessSchema(db);
      db.exec(`
        PRAGMA foreign_keys = OFF;
        DROP INDEX idx_conversations_project_updated;
        CREATE TABLE conversations_v3 (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL DEFAULT 'personal' REFERENCES conversation_projects(id),
          title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
          archived INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0,
          reasoning_level TEXT NOT NULL DEFAULT 'default', provider_id TEXT,
          profile_id TEXT NOT NULL DEFAULT 'assistant', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        INSERT INTO conversations_v3 (id, project_id, title, description, archived, pinned, reasoning_level, provider_id, profile_id, created_at, updated_at)
          SELECT id, project_id, title, description, archived, pinned, reasoning_level, provider_id, profile_id, created_at, updated_at FROM conversations;
        DROP TABLE conversations;
        ALTER TABLE conversations_v3 RENAME TO conversations;
        CREATE INDEX idx_conversations_project_updated ON conversations(project_id, updated_at DESC);
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL,
          app_version TEXT NOT NULL, source TEXT NOT NULL, applied_at TEXT NOT NULL
        );
      `);
      for (const migration of migrations.slice(0, 3)) {
        db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?, ?, ?, ?)')
          .run(migration.version, migration.name, migration.checksum, 'fixture', 'applied', '2026-08-31T00:00:00.000Z');
      }
      db.exec('PRAGMA user_version = 3; PRAGMA foreign_keys = ON;');
    } finally {
      db.close();
    }

    const owner = DatabaseOwner.open(databasePath);
    try {
      const runner = new MigrationRunner(owner, migrations, { appVersion: '0.3.5' });
      const result = runner.migrate({ id: 'v3-snapshot', status: 'verified', sourceVersion: 3, targetVersion, sha256: 'fixture' });
      assert.deepEqual(result.appliedVersions, [4, 5, 6, 7]);
      assert.equal(validateCanonicalSchema(owner.database, migrations).ok, true);
    } finally {
      owner.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('migrates an empty database through the continuous registry', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-migration-empty-'));
    const databasePath = path.join(dataDir, 'yuheng.sqlite');
    const owner = DatabaseOwner.open(databasePath);
    try {
      const runner = new MigrationRunner(owner, migrations, { appVersion: '0.3.2' });
      const result = runner.migrate({
        id: 'verified-empty-snapshot',
        status: 'verified',
        sourceVersion: 0,
        targetVersion,
        sha256: 'fixture',
      });

      assert.deepEqual(result, { sourceVersion: 0, targetVersion, appliedVersions: Array.from({ length: targetVersion }, (_, index) => index + 1), adoptedVersions: [] });
      const state = runner.inspect();
      assert.equal(state.userVersion, targetVersion);
      assert.deepEqual(state.ledger.map(({ version, source }) => [version, source]), Array.from({ length: targetVersion }, (_, index) => [index + 1, 'applied']));
      assert.equal(owner.database.prepare("SELECT name FROM conversation_projects WHERE id = 'personal'").get()?.name, '默认');
      assert.equal(validateCanonicalBusinessSchema(owner.database).ok, true);
      assert.deepEqual(validateCanonicalSchema(owner.database, migrations), { ok: true, violations: [] });
    } finally {
      owner.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('adopts every recognized v1 fixture and preserves its domain rows', () => {
    const variants = ['initial', 'provider-context', 'run-artifacts', 'task-board', 'notes', 'current'] as const;
    for (const variant of variants) {
      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `yuheng-migration-${variant}-`));
      const databasePath = createLegacyV1Fixture(dataDir, variant);
      const owner = DatabaseOwner.open(databasePath);
      try {
        const runner = new MigrationRunner(owner, migrations, { appVersion: '0.3.2' });
        const result = runner.migrate({ id: `snapshot-${variant}`, status: 'verified', sourceVersion: 1, targetVersion, sha256: 'fixture' });
        assert.deepEqual(result.adoptedVersions, [1], variant);
        assert.deepEqual(result.appliedVersions, Array.from({ length: targetVersion - 1 }, (_, index) => index + 2), variant);
        assert.equal(validateCanonicalBusinessSchema(owner.database).ok, true, variant);
        assert.equal(owner.database.prepare("SELECT name FROM conversation_projects WHERE id = 'personal'").get()?.name, '默认', variant);
        assert.equal(owner.database.prepare('SELECT title FROM conversations WHERE id = ?').get('fixture-conversation')?.title, '脱敏会话');
        assert.equal(owner.database.prepare('SELECT model FROM provider_profiles').get()?.model, 'fixture-model');
        if (variant === 'run-artifacts' || variant === 'task-board' || variant === 'notes' || variant === 'current') {
          assert.equal(owner.database.prepare('SELECT kind FROM run_artifacts WHERE id = ?').get('fixture-artifact')?.kind, 'browser_screenshot');
        }
        if (variant === 'task-board' || variant === 'notes' || variant === 'current') {
          assert.equal(owner.database.prepare('SELECT title FROM tasks WHERE id = ?').get('fixture-task')?.title, '脱敏任务');
        }
        if (variant === 'notes' || variant === 'current') {
          assert.equal(owner.database.prepare('SELECT title FROM notes WHERE id = ?').get('fixture-note')?.title, '脱敏笔记');
        }
      } finally {
        owner.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
      }
    }
  });

  it('is idempotent after the target ledger is complete', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-migration-repeat-'));
    const owner = DatabaseOwner.open(path.join(dataDir, 'yuheng.sqlite'));
    try {
      const runner = new MigrationRunner(owner, migrations, { appVersion: '0.3.2' });
      runner.migrate({ id: 'snapshot', status: 'verified', sourceVersion: 0, targetVersion, sha256: 'fixture' });
      const before = owner.database.prepare("SELECT group_concat(type || ':' || name || ':' || COALESCE(sql, ''), '|') AS schema FROM sqlite_master ORDER BY type, name").get()?.schema;
      const repeated = runner.migrate({ id: 'unused', status: 'verified', sourceVersion: targetVersion, targetVersion, sha256: 'unused' });
      const after = owner.database.prepare("SELECT group_concat(type || ':' || name || ':' || COALESCE(sql, ''), '|') AS schema FROM sqlite_master ORDER BY type, name").get()?.schema;
      assert.deepEqual(repeated, { sourceVersion: targetVersion, targetVersion, appliedVersions: [], adoptedVersions: [] });
      assert.equal(after, before);
      assert.equal(runner.inspect().ledger.length, targetVersion);
    } finally {
      owner.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('rolls back the current migration and its ledger row when migration code throws', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-migration-rollback-'));
    const owner = DatabaseOwner.open(path.join(dataDir, 'yuheng.sqlite'));
    const failingRegistry = [migrations[0], {
      version: 2,
      name: 'failing-fixture',
      checksum: createHash('sha256').update('failing-fixture').digest('hex'),
      up(db: typeof owner.database): void {
        db.exec('CREATE TABLE migration_should_rollback (id TEXT PRIMARY KEY)');
        throw new Error('fixture migration failure');
      },
    }] as const;
    try {
      const runner = new MigrationRunner(owner, failingRegistry, { appVersion: '0.3.2' });
      assert.throws(
        () => runner.migrate({ id: 'snapshot', status: 'verified', sourceVersion: 0, targetVersion: failingRegistry.length, sha256: 'fixture' }),
        /fixture migration failure/,
      );
      assert.equal(owner.database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'migration_should_rollback'").get(), undefined);
      assert.equal(runner.inspect().userVersion, 1);
      assert.deepEqual(runner.inspect().ledger.map((entry) => entry.version), [1]);
      assert.equal(Number((owner.database.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys), 1);
    } finally {
      owner.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('rejects a newer database before creating the migration ledger', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-migration-newer-'));
    const owner = DatabaseOwner.open(path.join(dataDir, 'yuheng.sqlite'));
    try {
      owner.database.exec(`CREATE TABLE future_data (id TEXT PRIMARY KEY); PRAGMA user_version = ${targetVersion + 1};`);
      const runner = new MigrationRunner(owner, migrations, { appVersion: '0.3.2' });
      assert.throws(
        () => runner.migrate({ id: 'snapshot', status: 'verified', sourceVersion: targetVersion + 1, targetVersion, sha256: 'fixture' }),
        (error: unknown) => error instanceof Error && 'code' in error && error.code === 'schema_too_new',
      );
      assert.equal(owner.database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get(), undefined);
      assert.ok(owner.database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'future_data'").get());
    } finally {
      owner.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('rejects ledger gaps and migration identity mismatches without changing rows', () => {
    const cases = [
      { name: 'gap', version: 2, migrationName: migrations[1].name, checksum: migrations[1].checksum, code: 'ledger_gap' },
      { name: 'name', version: 1, migrationName: 'changed-baseline', checksum: migrations[0].checksum, code: 'ledger_name_mismatch' },
      { name: 'checksum', version: 1, migrationName: migrations[0].name, checksum: '0'.repeat(64), code: 'ledger_checksum_mismatch' },
    ] as const;
    for (const fixture of cases) {
      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `yuheng-ledger-${fixture.name}-`));
      const owner = DatabaseOwner.open(path.join(dataDir, 'yuheng.sqlite'));
      try {
        owner.database.exec(`
          CREATE TABLE schema_migrations (
            version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL,
            app_version TEXT NOT NULL, source TEXT NOT NULL, applied_at TEXT NOT NULL
          );
          PRAGMA user_version = ${fixture.version};
        `);
        owner.database.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?, ?, ?, ?)')
          .run(fixture.version, fixture.migrationName, fixture.checksum, '0.3.2', 'applied', '2026-08-31T00:00:00.000Z');
        const runner = new MigrationRunner(owner, migrations, { appVersion: '0.3.2' });
        assert.throws(
          () => runner.migrate({ id: 'snapshot', status: 'verified', sourceVersion: fixture.version, targetVersion, sha256: 'fixture' }),
          (error: unknown) => error instanceof Error && 'code' in error && error.code === fixture.code,
          fixture.name,
        );
        assert.equal(Number(owner.database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()?.count), 1);
      } finally {
        owner.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
      }
    }
  });
});
