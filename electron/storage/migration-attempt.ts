import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type MigrationAttemptStage = 'checking' | 'snapshotting' | 'migrating' | 'verifying' | 'completed' | 'failed';
export type MigrationAttemptStatus = 'in_progress' | 'completed' | 'failed';

export type MigrationAttempt = {
  id: string;
  appVersion: string;
  sourceVersion: number;
  targetVersion: number;
  currentMigrationVersion: number | null;
  stage: MigrationAttemptStage;
  snapshotFileName: string | null;
  snapshotSha256: string | null;
  startedAt: string;
  updatedAt: string;
  status: MigrationAttemptStatus;
};

export type BeginMigrationAttempt = Pick<MigrationAttempt, 'appVersion' | 'sourceVersion' | 'targetVersion'>;
export type MigrationAttemptUpdate = Partial<Pick<MigrationAttempt,
  'currentMigrationVersion' | 'stage' | 'snapshotFileName' | 'snapshotSha256' | 'status'>>;

export type MigrationAttemptDependencies = {
  now?: () => Date;
  id?: () => string;
  beforeRename?: () => void;
};

export class MigrationAttemptStore {
  readonly attemptPath: string;
  private readonly now: () => Date;
  private readonly id: () => string;
  private readonly beforeRename: () => void;

  constructor(dataDirectory: string, dependencies: MigrationAttemptDependencies = {}) {
    const recoveryDirectory = path.join(dataDirectory, 'recovery');
    this.attemptPath = path.join(recoveryDirectory, 'migration-attempt.json');
    this.now = dependencies.now ?? (() => new Date());
    this.id = dependencies.id ?? randomUUID;
    this.beforeRename = dependencies.beforeRename ?? (() => undefined);
  }

  begin(input: BeginMigrationAttempt): MigrationAttempt {
    const timestamp = this.now().toISOString();
    const attempt: MigrationAttempt = {
      id: this.id(),
      ...input,
      currentMigrationVersion: null,
      stage: 'checking',
      snapshotFileName: null,
      snapshotSha256: null,
      startedAt: timestamp,
      updatedAt: timestamp,
      status: 'in_progress',
    };
    this.write(attempt);
    return attempt;
  }

  update(attempt: MigrationAttempt, patch: MigrationAttemptUpdate): MigrationAttempt {
    const updated: MigrationAttempt = { ...attempt, ...patch, updatedAt: this.now().toISOString() };
    this.write(updated);
    return updated;
  }

  complete(attempt: MigrationAttempt): MigrationAttempt {
    return this.update(attempt, { stage: 'completed', status: 'completed', currentMigrationVersion: null });
  }

  fail(attempt: MigrationAttempt): MigrationAttempt {
    return this.update(attempt, { stage: 'failed', status: 'failed' });
  }

  read(): MigrationAttempt | null {
    if (!fs.existsSync(this.attemptPath)) return null;
    const value = JSON.parse(fs.readFileSync(this.attemptPath, 'utf8')) as unknown;
    if (!isMigrationAttempt(value)) throw new Error('Invalid migration attempt record.');
    return value;
  }

  private write(attempt: MigrationAttempt): void {
    const directory = path.dirname(this.attemptPath);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = `${this.attemptPath}.tmp`;
    const descriptor = fs.openSync(temporaryPath, 'w', 0o600);
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(attempt, null, 2)}\n`, 'utf8');
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    try {
      this.beforeRename();
      fs.renameSync(temporaryPath, this.attemptPath);
      const directoryDescriptor = fs.openSync(directory, 'r');
      try { fs.fsyncSync(directoryDescriptor); }
      finally { fs.closeSync(directoryDescriptor); }
    } catch (error) {
      try { fs.unlinkSync(temporaryPath); } catch { /* Best-effort cleanup. */ }
      throw error;
    }
  }
}

function isMigrationAttempt(value: unknown): value is MigrationAttempt {
  if (!value || typeof value !== 'object') return false;
  const attempt = value as Partial<MigrationAttempt>;
  return typeof attempt.id === 'string'
    && typeof attempt.appVersion === 'string'
    && Number.isInteger(attempt.sourceVersion)
    && Number.isInteger(attempt.targetVersion)
    && (attempt.currentMigrationVersion === null || Number.isInteger(attempt.currentMigrationVersion))
    && typeof attempt.stage === 'string'
    && typeof attempt.startedAt === 'string'
    && typeof attempt.updatedAt === 'string'
    && (attempt.status === 'in_progress' || attempt.status === 'completed' || attempt.status === 'failed');
}
