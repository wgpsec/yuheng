import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { checkDatabaseIntegrity } from './integrity-check';
import { DiagnosticStore } from './diagnostics';
import { controlledSnapshotPath, hashFile, MigrationBackupStore } from './migration-backup';
import type { RecoverySnapshot, RestoreResult } from './recovery-types';

export type RecoveryFaultStage = 'validate' | 'copy' | 'isolate' | 'replace' | 'metadata';

export type RecoveryStoreDependencies = {
  now?: () => Date;
  id?: () => string;
  onStage?: (stage: RecoveryFaultStage) => void;
};

export class RecoveryError extends Error {
  constructor(readonly code: 'snapshot_invalid' | 'restore_failed', message: string) {
    super(message);
    this.name = 'RecoveryError';
  }
}

export class RecoveryStore {
  readonly databasePath: string;
  readonly failedDirectory: string;
  private readonly backups: MigrationBackupStore;
  private readonly diagnostics: DiagnosticStore;
  private readonly now: () => Date;
  private readonly id: () => string;
  private readonly onStage: (stage: RecoveryFaultStage) => void;

  constructor(readonly dataDirectory: string, dependencies: RecoveryStoreDependencies = {}) {
    this.databasePath = path.join(dataDirectory, 'yuheng.sqlite');
    this.failedDirectory = path.join(dataDirectory, 'recovery', 'failed');
    this.backups = new MigrationBackupStore(dataDirectory);
    this.diagnostics = new DiagnosticStore(dataDirectory);
    this.now = dependencies.now ?? (() => new Date());
    this.id = dependencies.id ?? randomUUID;
    this.onStage = dependencies.onStage ?? (() => undefined);
  }

  async listSnapshots(): Promise<RecoverySnapshot[]> {
    return this.backups.listSnapshots();
  }

  async restoreSnapshot(snapshotId: string): Promise<RestoreResult> {
    const snapshot = this.backups.listSnapshots().find((candidate) => candidate.id === snapshotId);
    if (!snapshot || (snapshot.status !== 'verified' && snapshot.status !== 'restored')) {
      throw new RecoveryError('snapshot_invalid', 'The selected snapshot is not available for recovery.');
    }
    this.onStage('validate');
    const snapshotPath = controlledSnapshotPath(this.backups.snapshotsDirectory, snapshot.fileName);
    if (await hashFile(snapshotPath) !== snapshot.sha256) throw new RecoveryError('snapshot_invalid', 'Snapshot hash verification failed.');
    assertHealthyDatabase(snapshotPath);

    fs.mkdirSync(this.dataDirectory, { recursive: true });
    const restoreTemporaryPath = path.join(this.dataDirectory, `.yuheng-restore-${snapshot.id}.tmp`);
    const failedName = `${this.now().toISOString().replace(/:/gu, '').replace('.000Z', 'Z')}-${this.id()}`;
    const failedPath = path.join(this.failedDirectory, failedName);
    const moved: Array<{ live: string; failed: string }> = [];
    let replacementInstalled = false;
    try {
      this.onStage('copy');
      fs.copyFileSync(snapshotPath, restoreTemporaryPath, fs.constants.COPYFILE_EXCL);
      fsyncFile(restoreTemporaryPath);
      if (await hashFile(restoreTemporaryPath) !== snapshot.sha256) throw new RecoveryError('snapshot_invalid', 'Restored copy hash verification failed.');
      assertHealthyDatabase(restoreTemporaryPath);

      fs.mkdirSync(failedPath, { recursive: true });
      this.onStage('isolate');
      for (const live of [this.databasePath, `${this.databasePath}-wal`, `${this.databasePath}-shm`]) {
        if (!fs.existsSync(live)) continue;
        const failed = path.join(failedPath, path.basename(live));
        fs.renameSync(live, failed);
        moved.push({ live, failed });
      }

      this.onStage('replace');
      fs.renameSync(restoreTemporaryPath, this.databasePath);
      replacementInstalled = true;
      fsyncDirectory(this.dataDirectory);

      this.onStage('metadata');
      this.backups.updateSnapshot({ ...snapshot, status: 'restored' });
      return { status: 'restored', snapshotId: snapshot.id, failedDatabaseDirectory: moved.length > 0 ? failedName : undefined };
    } catch (error) {
      if (replacementInstalled) removeFile(this.databasePath);
      removeFile(restoreTemporaryPath);
      for (const entry of moved.reverse()) {
        try {
          if (fs.existsSync(entry.failed) && !fs.existsSync(entry.live)) fs.renameSync(entry.failed, entry.live);
        } catch { /* Continue attempting to restore the remaining companions. */ }
      }
      try { fs.rmdirSync(failedPath); } catch { /* Keep non-empty quarantine for diagnosis. */ }
      if (error instanceof RecoveryError) throw error;
      throw new RecoveryError('restore_failed', error instanceof Error ? error.message : 'Snapshot restore failed.');
    }
  }

  async exportDiagnostics(diagnosticId: string, targetPath: string): Promise<void> {
    await this.diagnostics.export(diagnosticId, targetPath);
  }
}

function assertHealthyDatabase(filePath: string): void {
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    const integrity = checkDatabaseIntegrity(db);
    if (!integrity.ok) throw new RecoveryError('snapshot_invalid', 'Snapshot integrity verification failed.');
  } finally {
    db.close();
  }
}

function fsyncFile(filePath: string): void {
  const descriptor = fs.openSync(filePath, 'r');
  try { fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
}

function fsyncDirectory(directory: string): void {
  const descriptor = fs.openSync(directory, 'r');
  try { fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
}

function removeFile(filePath: string): void {
  try { fs.unlinkSync(filePath); } catch { /* Best-effort rollback cleanup. */ }
}
