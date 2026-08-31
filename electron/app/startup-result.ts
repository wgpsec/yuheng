export type StartupStage =
  | 'starting'
  | 'preflight'
  | 'checking'
  | 'snapshotting'
  | 'migrating'
  | 'verifying'
  | 'initializing'
  | 'ready'
  | 'recovery_required';

export type DatabaseStartupStage = Extract<StartupStage, 'checking' | 'snapshotting' | 'migrating' | 'verifying'>;

export type StartupFailureCode =
  | 'storage_unavailable'
  | 'database_corrupt'
  | 'schema_too_new'
  | 'snapshot_failed'
  | 'migration_failed'
  | 'verification_failed'
  | 'initialization_failed'
  | 'interrupted_migration';

export type StartupFailure = {
  code: StartupFailureCode;
  stage: Exclude<StartupStage, 'ready' | 'recovery_required'>;
  retryable: boolean;
  userMessage: string;
  diagnosticId: string;
  currentSchemaVersion?: number;
  targetSchemaVersion?: number;
};

export type StartupResult<TContext> =
  | { status: 'ready'; context: TContext }
  | { status: 'recovery_required'; failure: StartupFailure };
