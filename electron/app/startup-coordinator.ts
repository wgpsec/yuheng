import crypto from 'node:crypto';
import { AppContext } from './app-context';
import { ShutdownCoordinator } from './shutdown-coordinator';
import type { DatabaseStartupStage, StartupFailure, StartupResult, StartupStage } from './startup-result';

export type PreparedDatabase<TDatabase> = {
  value: TDatabase;
  close: () => void | Promise<void>;
};

export type DatabaseStartupResult<TDatabase> =
  | { status: 'ready'; database: PreparedDatabase<TDatabase> }
  | { status: 'recovery_required'; failure: StartupFailure };

export type DatabaseStartup<TDatabase> = {
  // The adapter owns every database resource until it returns a ready handle.
  prepare(reportStage: (stage: DatabaseStartupStage) => void): Promise<DatabaseStartupResult<TDatabase>>;
};

export type StartupCoordinatorOptions<TDatabase, TResources> = {
  database: DatabaseStartup<TDatabase>;
  initialize(database: TDatabase, shutdown: ShutdownCoordinator): Promise<TResources>;
  onStage?: (stage: StartupStage) => void;
  classifyUnexpectedFailure?: (
    error: unknown,
    stage: Exclude<StartupStage, 'ready' | 'recovery_required'>,
  ) => StartupFailure;
};

const TRANSITIONS: Record<StartupStage, readonly StartupStage[]> = {
  starting: ['preflight', 'recovery_required'],
  preflight: ['checking', 'recovery_required'],
  checking: ['snapshotting', 'verifying', 'recovery_required'],
  snapshotting: ['migrating', 'recovery_required'],
  migrating: ['verifying', 'recovery_required'],
  verifying: ['initializing', 'recovery_required'],
  initializing: ['ready', 'recovery_required'],
  ready: [],
  recovery_required: [],
};

export class StartupCoordinator<TDatabase, TResources> {
  constructor(private readonly options: StartupCoordinatorOptions<TDatabase, TResources>) {}

  async start(): Promise<StartupResult<AppContext<TResources>>> {
    const state: { stage: StartupStage } = { stage: 'starting' };
    let shutdown: ShutdownCoordinator | undefined;
    this.options.onStage?.(state.stage);

    const transition = (next: StartupStage): void => {
      if (!TRANSITIONS[state.stage].includes(next)) throw new Error(`Invalid startup transition: ${state.stage} -> ${next}`);
      state.stage = next;
      this.options.onStage?.(state.stage);
    };

    const recovery = (failure: StartupFailure): StartupResult<AppContext<TResources>> => {
      transition('recovery_required');
      return { status: 'recovery_required', failure };
    };

    try {
      transition('preflight');
      const databaseResult = await this.options.database.prepare((databaseStage) => transition(databaseStage));
      if (databaseResult.status === 'recovery_required') return recovery(databaseResult.failure);

      shutdown = new ShutdownCoordinator();
      shutdown.register('database', databaseResult.database.close);
      transition('initializing');
      const resources = await this.options.initialize(databaseResult.database.value, shutdown);
      transition('ready');
      return { status: 'ready', context: new AppContext(resources, shutdown) };
    } catch (error) {
      if (shutdown) await shutdown.close();
      const failedAt = state.stage === 'ready' || state.stage === 'recovery_required' ? 'initializing' : state.stage;
      const failure = this.options.classifyUnexpectedFailure?.(error, failedAt) ?? {
        code: 'initialization_failed',
        stage: failedAt,
        retryable: true,
        userMessage: '玉衡启动时发生未预期错误，请重试或导出诊断信息。',
        diagnosticId: crypto.randomUUID(),
      };
      if (state.stage === 'recovery_required') return { status: 'recovery_required', failure };
      return recovery(failure);
    }
  }
}
