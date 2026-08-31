import type { DatabaseConnection } from './database';

export type Migration = {
  version: number;
  name: string;
  checksum: string;
  up(db: DatabaseConnection): void;
};

export type MigrationLedgerEntry = {
  version: number;
  name: string;
  checksum: string;
  appVersion: string;
  source: 'applied' | 'adopted';
  appliedAt: string;
};

export type VerifiedMigrationSnapshot = {
  id: string;
  status: 'verified';
  sourceVersion: number;
  targetVersion: number;
  sha256: string;
};
