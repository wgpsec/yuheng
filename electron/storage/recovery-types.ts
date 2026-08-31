import type { DatabaseOwner } from './database';

export type RecoverySnapshotStatus = 'verified' | 'restored' | 'unhealthy' | 'invalid';

export type RecoverySnapshot = {
  id: string;
  fileName: string;
  sha256: string;
  sourceVersion: number;
  targetVersion: number;
  appVersion: string;
  createdAt: string;
  originalDatabaseSize: number;
  quickCheck: string[];
  foreignKeyViolationCount: number;
  status: RecoverySnapshotStatus;
};

export type StorageFailureCode =
  | 'storage_unavailable'
  | 'database_corrupt'
  | 'schema_too_new'
  | 'snapshot_failed'
  | 'migration_failed'
  | 'verification_failed'
  | 'interrupted_migration';

export type StorageFailure = {
  code: StorageFailureCode;
  stage: string;
  retryable: boolean;
  currentVersion?: number;
  targetVersion: number;
  diagnosticId: string;
  userMessage: string;
};

export type DatabasePreparationResult =
  | {
      status: 'ready';
      owner: DatabaseOwner;
      sourceVersion: number;
      targetVersion: number;
      snapshot?: RecoverySnapshot;
    }
  | {
      status: 'recovery_required';
      failure: StorageFailure;
    };

export type RestoreResult = {
  status: 'restored';
  snapshotId: string;
  failedDatabaseDirectory?: string;
};

export interface StorageRecovery {
  listSnapshots(): Promise<RecoverySnapshot[]>;
  restoreSnapshot(snapshotId: string): Promise<RestoreResult>;
  exportDiagnostics(diagnosticId: string, targetPath: string): Promise<void>;
}
