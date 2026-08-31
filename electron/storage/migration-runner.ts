import type { DatabaseOwner } from './database';
import type { Migration, MigrationLedgerEntry, VerifiedMigrationSnapshot } from './migration';
import { inspectLegacyV1Schema, validateCanonicalBusinessSchema } from './schema';

type Row = Record<string, unknown>;

export type MigrationState = {
  userVersion: number;
  ledger: MigrationLedgerEntry[];
};

export type MigrationResult = {
  sourceVersion: number;
  targetVersion: number;
  appliedVersions: number[];
  adoptedVersions: number[];
};

export type MigrationRunnerOptions = {
  appVersion: string;
  now?: () => Date;
};

export class MigrationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

export class MigrationRunner {
  private readonly now: () => Date;

  constructor(
    private readonly owner: DatabaseOwner,
    private readonly registry: readonly Migration[],
    private readonly options: MigrationRunnerOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    validateRegistry(registry);
  }

  inspect(): MigrationState {
    const db = this.owner.database;
    const userVersion = Number((db.prepare('PRAGMA user_version').get() as Row).user_version);
    const hasLedger = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get());
    if (!hasLedger) return { userVersion, ledger: [] };
    const ledger = (db.prepare('SELECT version, name, checksum, app_version AS appVersion, source, applied_at AS appliedAt FROM schema_migrations ORDER BY version').all() as Row[])
      .map((row) => ({
        version: Number(row.version),
        name: String(row.name),
        checksum: String(row.checksum),
        appVersion: String(row.appVersion),
        source: row.source as MigrationLedgerEntry['source'],
        appliedAt: String(row.appliedAt),
      }));
    return { userVersion, ledger };
  }

  migrate(snapshot: VerifiedMigrationSnapshot): MigrationResult {
    const targetVersion = this.registry.length;
    const initialState = this.inspect();
    validateState(initialState, this.registry);
    if (initialState.userVersion > targetVersion) {
      throw new MigrationError('schema_too_new', `Database schema ${initialState.userVersion} is newer than supported schema ${targetVersion}.`);
    }
    if (initialState.userVersion === targetVersion && initialState.ledger.length === targetVersion) {
      return { sourceVersion: targetVersion, targetVersion, appliedVersions: [], adoptedVersions: [] };
    }
    if (snapshot.status !== 'verified' || snapshot.sourceVersion !== initialState.userVersion || snapshot.targetVersion !== targetVersion) {
      throw new MigrationError('snapshot_required', 'A matching verified migration snapshot is required.');
    }

    const adoptedVersions: number[] = [];
    if (initialState.userVersion === 1 && initialState.ledger.length === 0) {
      if (!inspectLegacyV1Schema(this.owner.database).recognized) {
        throw new MigrationError('unrecognized_legacy_schema', 'The version 1 database is not a recognized Yuheng schema.');
      }
      this.owner.transaction((db) => {
        createLedger(db);
        insertLedger(db, this.registry[0], this.options.appVersion, 'adopted', this.now());
      });
      adoptedVersions.push(1);
    }

    const state = this.inspect();
    const appliedVersions: number[] = [];
    for (const migration of this.registry.slice(state.ledger.length)) {
      this.owner.database.exec('PRAGMA foreign_keys = OFF');
      try {
        this.owner.transaction((db) => {
          createLedger(db);
          migration.up(db);
          const invariant = validateCanonicalBusinessSchema(db);
          if (!invariant.ok) throw new MigrationError('schema_invariant_failed', invariant.violations.join(', '));
          insertLedger(db, migration, this.options.appVersion, 'applied', this.now());
          db.exec(`PRAGMA user_version = ${migration.version}`);
        });
      } finally {
        this.owner.database.exec('PRAGMA foreign_keys = ON');
      }
      appliedVersions.push(migration.version);
    }
    return { sourceVersion: initialState.userVersion, targetVersion, appliedVersions, adoptedVersions };
  }
}

function validateRegistry(registry: readonly Migration[]): void {
  if (registry.length === 0) throw new MigrationError('invalid_registry', 'Migration registry cannot be empty.');
  registry.forEach((migration, index) => {
    if (migration.version !== index + 1) throw new MigrationError('invalid_registry', 'Migration versions must be continuous and ordered.');
    if (!migration.name || !/^[a-f0-9]{64}$/u.test(migration.checksum)) throw new MigrationError('invalid_registry', `Migration ${migration.version} has invalid metadata.`);
  });
}

function validateState(state: MigrationState, registry: readonly Migration[]): void {
  for (let index = 0; index < state.ledger.length; index += 1) {
    const entry = state.ledger[index];
    const expected = registry[index];
    if (!expected || entry.version !== index + 1) throw new MigrationError('ledger_gap', 'Migration ledger versions must be continuous.');
    if (entry.name !== expected.name) throw new MigrationError('ledger_name_mismatch', `Migration ${entry.version} name does not match the registry.`);
    if (entry.checksum !== expected.checksum) throw new MigrationError('ledger_checksum_mismatch', `Migration ${entry.version} checksum does not match the registry.`);
    if (entry.source !== 'applied' && entry.source !== 'adopted') throw new MigrationError('invalid_ledger_source', `Migration ${entry.version} has an invalid source.`);
  }
  if (state.ledger.length > 0 && state.userVersion !== state.ledger.at(-1)?.version) {
    throw new MigrationError('version_mismatch', 'PRAGMA user_version does not match the migration ledger.');
  }
}

function createLedger(db: DatabaseOwner['database']): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      app_version TEXT NOT NULL,
      source TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
}

function insertLedger(db: DatabaseOwner['database'], migration: Migration, appVersion: string, source: MigrationLedgerEntry['source'], now: Date): void {
  db.prepare('INSERT INTO schema_migrations (version, name, checksum, app_version, source, applied_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(migration.version, migration.name, migration.checksum, appVersion, source, now.toISOString());
}
