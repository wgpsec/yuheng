import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import type { DatabaseOwner } from './database';
import { checkDatabaseIntegrity, type DatabaseIntegrityResult } from './integrity-check';
import type { RecoverySnapshot } from './recovery-types';

const SNAPSHOT_NAME = /^[0-9TZ.-]+-v\d+-to-v\d+-[a-zA-Z0-9-]+\.sqlite$/u;
const SAFETY_MARGIN_BYTES = 16 * 1024 * 1024;

export type MigrationBackupFaultStage =
  | 'writable-check'
  | 'space-check'
  | 'wal-checkpoint'
  | 'snapshot-write'
  | 'snapshot-verify'
  | 'snapshot-fsync'
  | 'snapshot-rename'
  | 'metadata-write'
  | 'metadata-rename';

export type MigrationBackupDependencies = {
  now?: () => Date;
  id?: () => string;
  availableBytes?: (directory: string) => number;
  onStage?: (stage: MigrationBackupFaultStage) => void;
};

export type CreateSnapshotInput = {
  sourceVersion: number;
  targetVersion: number;
  appVersion: string;
};

export class SnapshotError extends Error {
  constructor(readonly code: 'storage_unavailable' | 'snapshot_failed', message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export class MigrationBackupStore {
  readonly recoveryDirectory: string;
  readonly snapshotsDirectory: string;
  private readonly now: () => Date;
  private readonly id: () => string;
  private readonly availableBytes: (directory: string) => number;
  private readonly onStage: (stage: MigrationBackupFaultStage) => void;

  constructor(readonly dataDirectory: string, dependencies: MigrationBackupDependencies = {}) {
    this.recoveryDirectory = path.join(dataDirectory, 'recovery');
    this.snapshotsDirectory = path.join(this.recoveryDirectory, 'snapshots');
    this.now = dependencies.now ?? (() => new Date());
    this.id = dependencies.id ?? randomUUID;
    this.availableBytes = dependencies.availableBytes ?? availableBytes;
    this.onStage = dependencies.onStage ?? (() => undefined);
  }

  async createSnapshot(owner: DatabaseOwner, input: CreateSnapshotInput): Promise<RecoverySnapshot> {
    try {
      fs.mkdirSync(this.snapshotsDirectory, { recursive: true });
    } catch (error) {
      throw new SnapshotError('storage_unavailable', error instanceof Error ? error.message : 'Snapshot directory is unavailable.');
    }
    this.stage('writable-check', () => fs.accessSync(this.snapshotsDirectory, fs.constants.W_OK));
    const databaseSize = fs.statSync(owner.databasePath).size;
    const walSize = fileSize(`${owner.databasePath}-wal`);
    const requiredBytes = (databaseSize + walSize) * 2 + SAFETY_MARGIN_BYTES;
    this.stage('space-check', () => {
      if (this.availableBytes(this.snapshotsDirectory) < requiredBytes) throw new Error('Insufficient storage for a verified migration snapshot.');
    });

    const preflight = checkDatabaseIntegrity(owner.database);
    if (!preflight.ok) throw new SnapshotError('snapshot_failed', 'The database failed pre-snapshot integrity checks.');
    this.stage('wal-checkpoint', () => checkpointWal(owner));

    const createdAt = this.now().toISOString();
    const compactTime = createdAt.replace(/:/gu, '').replace('.000Z', 'Z');
    const snapshotId = `${compactTime}-v${input.sourceVersion}-to-v${input.targetVersion}-${this.id()}`;
    const fileName = `${snapshotId}.sqlite`;
    const finalPath = path.join(this.snapshotsDirectory, fileName);
    const temporaryPath = `${finalPath}.tmp`;
    const metadataPath = path.join(this.snapshotsDirectory, `${snapshotId}.json`);
    try {
      this.onStage('snapshot-write');
      await backup(owner.database, temporaryPath);
      this.onStage('snapshot-verify');
      const verified = inspectReadOnlySnapshot(temporaryPath);
      if (!verified.ok) throw new Error('Snapshot integrity verification failed.');
      const sha256 = await hashFile(temporaryPath);
      removeFile(`${temporaryPath}-wal`);
      removeFile(`${temporaryPath}-shm`);
      this.stage('snapshot-fsync', () => fsyncFile(temporaryPath));
      this.stage('snapshot-rename', () => fs.renameSync(temporaryPath, finalPath));
      fsyncDirectory(this.snapshotsDirectory);

      const snapshot: RecoverySnapshot = {
        id: snapshotId,
        fileName,
        sha256,
        sourceVersion: input.sourceVersion,
        targetVersion: input.targetVersion,
        appVersion: input.appVersion,
        createdAt,
        originalDatabaseSize: databaseSize,
        quickCheck: verified.quickCheck,
        foreignKeyViolationCount: verified.foreignKeyViolations.length,
        status: 'verified',
      };
      this.onStage('metadata-write');
      writeJsonFile(`${metadataPath}.tmp`, snapshot);
      this.stage('metadata-rename', () => fs.renameSync(`${metadataPath}.tmp`, metadataPath));
      fsyncDirectory(this.snapshotsDirectory);
      this.pruneSnapshots(5, snapshot.id);
      return snapshot;
    } catch (error) {
      removeFile(temporaryPath);
      removeFile(`${temporaryPath}-wal`);
      removeFile(`${temporaryPath}-shm`);
      removeFile(`${metadataPath}.tmp`);
      if (!fs.existsSync(metadataPath)) removeFile(finalPath);
      if (error instanceof SnapshotError) throw error;
      throw new SnapshotError('snapshot_failed', error instanceof Error ? error.message : 'Snapshot creation failed.');
    }
  }

  listSnapshots(): RecoverySnapshot[] {
    if (!fs.existsSync(this.snapshotsDirectory)) return [];
    const snapshots: RecoverySnapshot[] = [];
    for (const entry of fs.readdirSync(this.snapshotsDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        const value = JSON.parse(fs.readFileSync(path.join(this.snapshotsDirectory, entry.name), 'utf8')) as RecoverySnapshot;
        if (!isRecoverySnapshot(value)) continue;
        const snapshotPath = controlledSnapshotPath(this.snapshotsDirectory, value.fileName);
        if (!fs.statSync(snapshotPath).isFile()) continue;
        snapshots.push(value);
      } catch { /* Ignore incomplete or invalid metadata. */ }
    }
    return snapshots.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  updateSnapshot(snapshot: RecoverySnapshot): void {
    const filePath = controlledSnapshotPath(this.snapshotsDirectory, snapshot.fileName);
    if (!fs.existsSync(filePath)) throw new SnapshotError('snapshot_failed', 'Snapshot file is missing.');
    const metadataPath = path.join(this.snapshotsDirectory, `${snapshot.id}.json`);
    const temporaryPath = `${metadataPath}.tmp`;
    writeJsonFile(temporaryPath, snapshot);
    try {
      fs.renameSync(temporaryPath, metadataPath);
      fsyncDirectory(this.snapshotsDirectory);
    } catch (error) {
      removeFile(temporaryPath);
      throw error;
    }
  }

  private pruneSnapshots(retention: number, protectedId: string): void {
    const verified = this.listSnapshots().filter((snapshot) => snapshot.status === 'verified');
    for (const snapshot of verified.slice(retention)) {
      if (snapshot.id === protectedId || verified.length === 1) continue;
      try {
        const filePath = controlledSnapshotPath(this.snapshotsDirectory, snapshot.fileName);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
          removeFile(path.join(this.snapshotsDirectory, `${snapshot.id}.json`));
        }
      } catch { /* Retention cleanup never blocks startup. */ }
    }
  }

  private stage<T>(stage: MigrationBackupFaultStage, operation: () => T): T {
    try {
      this.onStage(stage);
      return operation();
    } catch (error) {
      const code = stage === 'writable-check' || stage === 'space-check' ? 'storage_unavailable' : 'snapshot_failed';
      throw new SnapshotError(code, error instanceof Error ? error.message : `Snapshot ${stage} failed.`);
    }
  }
}

export function controlledSnapshotPath(directory: string, fileName: string): string {
  if (!SNAPSHOT_NAME.test(fileName) || path.basename(fileName) !== fileName) throw new SnapshotError('snapshot_failed', 'Invalid snapshot path.');
  const resolvedDirectory = path.resolve(directory);
  const resolved = path.resolve(directory, fileName);
  if (path.dirname(resolved) !== resolvedDirectory) throw new SnapshotError('snapshot_failed', 'Invalid snapshot path.');
  return resolved;
}

export async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

function checkpointWal(owner: DatabaseOwner): void {
  const row = owner.database.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as Record<string, unknown> | undefined;
  if (Number(row?.busy ?? 0) !== 0) throw new Error('WAL checkpoint is busy.');
}

function inspectReadOnlySnapshot(filePath: string): DatabaseIntegrityResult {
  const db = new DatabaseSync(filePath, { readOnly: true });
  try { return checkDatabaseIntegrity(db); }
  finally { db.close(); }
}

function availableBytes(directory: string): number {
  const stats = fs.statfsSync(directory);
  return Number(stats.bavail) * Number(stats.bsize);
}

function fileSize(filePath: string): number {
  try { return fs.statSync(filePath).size; }
  catch { return 0; }
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

function writeJsonFile(filePath: string, value: unknown): void {
  const descriptor = fs.openSync(filePath, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function removeFile(filePath: string): void {
  try { fs.unlinkSync(filePath); } catch { /* Best-effort cleanup. */ }
}

function isRecoverySnapshot(value: unknown): value is RecoverySnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<RecoverySnapshot>;
  return typeof snapshot.id === 'string'
    && typeof snapshot.fileName === 'string'
    && snapshot.fileName === `${snapshot.id}.sqlite`
    && SNAPSHOT_NAME.test(snapshot.fileName)
    && typeof snapshot.sha256 === 'string'
    && /^[a-f0-9]{64}$/u.test(snapshot.sha256)
    && typeof snapshot.sourceVersion === 'number'
    && typeof snapshot.targetVersion === 'number'
    && typeof snapshot.createdAt === 'string'
    && (snapshot.status === 'verified' || snapshot.status === 'restored' || snapshot.status === 'unhealthy' || snapshot.status === 'invalid');
}
