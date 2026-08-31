import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ShutdownCoordinator } from '../electron/app/shutdown-coordinator';
import { StartupCoordinator, type DatabaseStartup } from '../electron/app/startup-coordinator';
import type { StartupFailure, StartupStage } from '../electron/app/startup-result';

describe('StartupCoordinator', () => {
  it('opens the application only after database verification and closes resources in reverse order', async () => {
    const stages: StartupStage[] = [];
    const closed: string[] = [];
    const database: DatabaseStartup<{ id: string }> = {
      prepare: async (report) => {
        report('checking');
        report('verifying');
        return { status: 'ready', database: { value: { id: 'db' }, close: () => { closed.push('database'); } } };
      },
    };
    const coordinator = new StartupCoordinator({
      database,
      onStage: (stage) => { stages.push(stage); },
      initialize: async (db, shutdown) => {
        assert.equal(db.id, 'db');
        shutdown.register('runtime', () => { closed.push('runtime'); });
        shutdown.register('reminders', async () => { closed.push('reminders'); });
        return { windowCount: 1 };
      },
    });

    const result = await coordinator.start();

    assert.deepEqual(stages, ['starting', 'preflight', 'checking', 'verifying', 'initializing', 'ready']);
    assert.equal(result.status, 'ready');
    if (result.status !== 'ready') return;
    assert.deepEqual(result.context.resources, { windowCount: 1 });
    assert.deepEqual(await result.context.close(), { errors: [] });
    assert.deepEqual(await result.context.close(), { errors: [] });
    assert.deepEqual(closed, ['reminders', 'runtime', 'database']);
  });

  it('supports the snapshot and migration path before initialization', async () => {
    const stages: StartupStage[] = [];
    const coordinator = new StartupCoordinator({
      database: {
        prepare: async (report) => {
          report('checking');
          report('snapshotting');
          report('migrating');
          report('verifying');
          return { status: 'ready', database: { value: 'database', close: () => undefined } };
        },
      },
      onStage: (stage) => { stages.push(stage); },
      initialize: async () => 'resources',
    });

    assert.equal((await coordinator.start()).status, 'ready');
    assert.deepEqual(stages, ['starting', 'preflight', 'checking', 'snapshotting', 'migrating', 'verifying', 'initializing', 'ready']);
  });

  it('returns a storage failure without initializing normal application resources', async () => {
    const failure: StartupFailure = {
      code: 'schema_too_new',
      stage: 'checking',
      retryable: false,
      userMessage: '当前应用版本过旧。',
      diagnosticId: 'diagnostic-1',
      currentSchemaVersion: 4,
      targetSchemaVersion: 2,
    };
    let initialized = false;
    const stages: StartupStage[] = [];
    const coordinator = new StartupCoordinator({
      database: {
        prepare: async (report) => {
          report('checking');
          return { status: 'recovery_required', failure };
        },
      },
      onStage: (stage) => { stages.push(stage); },
      initialize: async () => { initialized = true; return {}; },
    });

    assert.deepEqual(await coordinator.start(), { status: 'recovery_required', failure });
    assert.equal(initialized, false);
    assert.deepEqual(stages, ['starting', 'preflight', 'checking', 'recovery_required']);
  });

  it('closes partially initialized resources and the database when initialization fails', async () => {
    const closed: string[] = [];
    const coordinator = new StartupCoordinator({
      database: {
        prepare: async (report) => {
          report('checking');
          report('verifying');
          return { status: 'ready', database: { value: {}, close: () => { closed.push('database'); } } };
        },
      },
      initialize: async (_database, shutdown) => {
        shutdown.register('secret-store', () => { closed.push('secret-store'); });
        throw new Error('sensitive implementation detail');
      },
    });

    const result = await coordinator.start();

    assert.equal(result.status, 'recovery_required');
    if (result.status !== 'recovery_required') return;
    assert.equal(result.failure.code, 'initialization_failed');
    assert.equal(result.failure.stage, 'initializing');
    assert.doesNotMatch(result.failure.userMessage, /sensitive implementation detail/);
    assert.deepEqual(closed, ['secret-store', 'database']);
  });
});

describe('ShutdownCoordinator', () => {
  it('continues closing resources after failures and does not close any resource twice', async () => {
    const closed: string[] = [];
    const shutdown = new ShutdownCoordinator();
    shutdown.register('database', () => { closed.push('database'); });
    shutdown.register('sidecar', () => { closed.push('sidecar'); throw new Error('close failed'); });
    const unregisterTimer = shutdown.register('timer', () => { closed.push('timer'); });
    unregisterTimer();

    const first = await shutdown.close();
    const second = await shutdown.close();

    assert.deepEqual(closed, ['sidecar', 'database']);
    assert.equal(first.errors.length, 1);
    assert.equal(first.errors[0]?.resource, 'sidecar');
    assert.strictEqual(second, first);
    assert.throws(() => shutdown.register('late-resource', () => undefined), /after shutdown/);
  });
});
