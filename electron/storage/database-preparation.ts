import fs from 'node:fs';
import path from 'node:path';
import { DatabaseOwner } from './database';
import { DiagnosticStore } from './diagnostics';
import { checkDatabaseIntegrity } from './integrity-check';
import { MigrationAttemptStore, type MigrationAttempt } from './migration-attempt';
import { MigrationBackupStore } from './migration-backup';
import { MigrationError, MigrationRunner } from './migration-runner';
import { migrations } from './migrations';
import { validateCanonicalSchema } from './schema';
import type { DatabasePreparationResult, StorageFailure, StorageFailureCode } from './recovery-types';
import type { RecoverySnapshot } from './recovery-types';
import type { VerifiedMigrationSnapshot } from './migration';

export type PrepareDatabaseOptions = {
  appVersion: string;
  now?: () => Date;
  diagnosticId?: () => string;
};

export async function prepareDatabase(dataDirectory: string, options: PrepareDatabaseOptions): Promise<DatabasePreparationResult> {
  const databasePath = path.join(dataDirectory, 'yuheng.sqlite');
  const targetVersion = migrations.length;
  const attempts = new MigrationAttemptStore(dataDirectory, { now: options.now, id: options.diagnosticId });
  const diagnostics = new DiagnosticStore(dataDirectory, { now: options.now, id: options.diagnosticId });
  const attemptBeforeStart = safeReadAttempt(attempts);
  if (attemptBeforeStart?.status === 'in_progress') {
    return recoveryFailure(diagnostics, {
      code: 'interrupted_migration', stage: attemptBeforeStart.stage, retryable: true,
      currentVersion: attemptBeforeStart.currentMigrationVersion ?? attemptBeforeStart.sourceVersion,
      targetVersion, diagnosticId: attemptBeforeStart.id,
      userMessage: '上次数据迁移未完成，请重试或恢复迁移前快照。',
    }, attemptBeforeStart);
  }

  let owner: DatabaseOwner;
  let attempt: MigrationAttempt | null = null;
  try {
    preflightDataDirectory(dataDirectory, databasePath);
    owner = DatabaseOwner.open(databasePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const code = /not a database|malformed|corrupt/iu.test(message) ? 'database_corrupt' : 'storage_unavailable';
    return recoveryFailure(diagnostics, failureFromError(error, 'preflight', targetVersion, dataDirectory, code), undefined);
  }

  try {
    const integrity = checkDatabaseIntegrity(owner.database);
    if (!integrity.ok) {
      return recoveryFailure(diagnostics, failureFromError(new Error('Database integrity check failed.'), 'checking', targetVersion, dataDirectory, 'database_corrupt'), undefined, owner);
    }
    const runner = new MigrationRunner(owner, migrations, { appVersion: options.appVersion, now: options.now });
    const state = runner.inspect();
    if (state.userVersion > targetVersion) {
      return recoveryFailure(diagnostics, failureFromError(new MigrationError('schema_too_new', 'Database schema is newer than supported.'), 'checking', targetVersion, dataDirectory), undefined, owner);
    }
    if (state.userVersion === targetVersion && state.ledger.length === targetVersion) {
      const validation = validateCanonicalSchema(owner.database, migrations);
      if (!validation.ok) return recoveryFailure(diagnostics, failureFromError(new Error(validation.violations.join(', ')), 'verifying', targetVersion, dataDirectory, 'verification_failed', state.userVersion), undefined, owner);
      return { status: 'ready', owner, sourceVersion: state.userVersion, targetVersion };
    }

    attempt = attempts.begin({ appVersion: options.appVersion, sourceVersion: state.userVersion, targetVersion });
    const backups = new MigrationBackupStore(dataDirectory, { now: options.now, id: options.diagnosticId });
    attempt = attempts.update(attempt, { stage: 'snapshotting' });
    const snapshot = await backups.createSnapshot(owner, { sourceVersion: state.userVersion, targetVersion, appVersion: options.appVersion });
    if (snapshot.status !== 'verified') throw new Error('Migration snapshot was not verified.');
    attempt = attempts.update(attempt, { stage: 'migrating', snapshotFileName: snapshot.fileName, snapshotSha256: snapshot.sha256 });
    const migrationSnapshot: VerifiedMigrationSnapshot = { id: snapshot.id, status: 'verified', sourceVersion: snapshot.sourceVersion, targetVersion: snapshot.targetVersion, sha256: snapshot.sha256 };
    const migrationResult = runner.migrate(migrationSnapshot);
    attempt = attempts.update(attempt, { stage: 'verifying', currentMigrationVersion: migrationResult.targetVersion });
    const validation = validateCanonicalSchema(owner.database, migrations);
    if (!validation.ok) throw new MigrationError('verification_failed', validation.violations.join(', '));
    attempts.complete(attempt);
    return { status: 'ready', owner, sourceVersion: migrationResult.sourceVersion, targetVersion, snapshot };
  } catch (error) {
    if (attempt) attempts.fail(attempt);
    return recoveryFailure(diagnostics, failureFromError(error, attempt?.stage ?? 'initializing', targetVersion, dataDirectory), attempt ?? undefined, owner);
  }
}

function preflightDataDirectory(dataDirectory: string, databasePath: string): void {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const stats = fs.lstatSync(dataDirectory);
  if (!stats.isDirectory()) throw new Error('Data path is not a directory.');
  if (fs.existsSync(databasePath) && fs.lstatSync(databasePath).isSymbolicLink()) throw new Error('Database path must not be a symbolic link.');
}

function recoveryFailure(diagnostics: DiagnosticStore, failure: StorageFailure, attempt: MigrationAttempt | undefined, owner?: DatabaseOwner): DatabasePreparationResult {
  const report = diagnostics.record({
    appVersion: 'unknown', electronVersion: process.versions.electron ?? 'unknown', nodeVersion: process.version,
    platform: process.platform, arch: process.arch, stage: failure.stage, code: failure.code,
    retryable: failure.retryable, currentVersion: failure.currentVersion, targetVersion: failure.targetVersion,
    ledger: [], snapshots: [], integrity: { quickCheck: [], foreignKeyViolationCount: 0 },
    errorSummary: failure.userMessage, userMessage: failure.userMessage,
  });
  diagnostics.persist(report);
  if (owner) owner.close();
  return { status: 'recovery_required', failure: { ...failure, diagnosticId: failure.diagnosticId || report.diagnosticId } };
}

function failureFromError(error: unknown, stage: string, targetVersion: number, _dataDirectory: string, forcedCode?: StorageFailureCode, currentVersion?: number): StorageFailure {
  const migrationCode = error instanceof MigrationError ? error.code : undefined;
  const code = forcedCode ?? (migrationCode === 'schema_too_new' ? 'schema_too_new' : migrationCode === 'snapshot_required' ? 'snapshot_failed' : stage === 'preflight' ? 'storage_unavailable' : stage === 'checking' ? 'database_corrupt' : stage === 'verifying' ? 'verification_failed' : 'migration_failed');
  return {
    code: code as StorageFailureCode,
    stage,
    retryable: code !== 'schema_too_new' && code !== 'database_corrupt',
    currentVersion,
    targetVersion,
    diagnosticId: '',
    userMessage: code === 'schema_too_new' ? '当前数据由更高版本创建，无法由此版本打开。' : code === 'database_corrupt' ? '数据文件完整性检查失败，请恢复迁移前快照。' : '数据准备失败，请重试或导出诊断。',
  };
}

function safeReadAttempt(attempts: MigrationAttemptStore): MigrationAttempt | null {
  try { return attempts.read(); } catch { return null; }
}
