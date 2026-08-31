import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { registerRecoveryIpc, type RecoveryIpcEvent, type RecoveryIpcRegistrar } from '../electron/ipc/register-recovery-ipc';
import { RECOVERY_CHANNELS } from '../electron/recovery-channels';
import type { StartupFailure } from '../electron/app/startup-result';

class FakeIpc implements RecoveryIpcRegistrar {
  readonly handlers = new Map<string, (event: RecoveryIpcEvent, ...args: unknown[]) => unknown>();

  handle(channel: string, listener: (event: RecoveryIpcEvent, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, listener);
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }

  invoke(channel: string, senderId: number, ...args: unknown[]): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) return Promise.reject(new Error('missing handler'));
    try { return Promise.resolve(handler({ sender: { id: senderId } }, ...args)); }
    catch (error) { return Promise.reject(error); }
  }
}

const startupFailure = (): StartupFailure => ({
  code: 'migration_failed',
  stage: 'migrating',
  retryable: true,
  userMessage: '数据迁移未完成。',
  diagnosticId: 'diagnostic-1',
  currentSchemaVersion: 1,
  targetSchemaVersion: 2,
});

describe('recovery IPC', () => {
  it('registers only the recovery surface and rejects every other sender', async () => {
    const ipc = new FakeIpc();
    const dispose = registerRecoveryIpc({
      ipc,
      senderId: 42,
      recovery: { listSnapshots: async () => [], restoreSnapshot: async () => ({ status: 'restored', snapshotId: 'id' }), exportDiagnostics: async () => undefined },
      getFailure: startupFailure,
      retry: async () => ({ status: 'recovery_required', failure: startupFailure() }),
      chooseDiagnosticTarget: async () => null,
      openDirectory: async () => undefined,
      quit: () => undefined,
    });

    assert.deepEqual([...ipc.handlers.keys()].sort(), Object.values(RECOVERY_CHANNELS).sort());
    await assert.rejects(ipc.invoke(RECOVERY_CHANNELS.getStatus, 7), /not authorized/);
    assert.equal((await ipc.invoke(RECOVERY_CHANNELS.getStatus, 42) as { failure: { phase: string } }).failure.phase, 'migrating');
    dispose();
    dispose();
    assert.equal(ipc.handlers.size, 0);
  });

  it('maps snapshots to the renderer contract and omits storage-only fields', async () => {
    const ipc = new FakeIpc();
    registerRecoveryIpc({
      ipc,
      senderId: 1,
      recovery: {
        listSnapshots: async () => [{
          id: '2026-08-31T100000Z-v1-to-v2-id', fileName: 'secret.sqlite', sha256: 'a'.repeat(64), sourceVersion: 1,
          targetVersion: 2, appVersion: '0.3.2', createdAt: '2026-08-31T10:00:00Z', originalDatabaseSize: 123,
          quickCheck: ['ok'], foreignKeyViolationCount: 0, status: 'verified',
        }],
        restoreSnapshot: async () => ({ status: 'restored', snapshotId: 'id' }), exportDiagnostics: async () => undefined,
      },
      getFailure: startupFailure,
      retry: async () => ({ status: 'ready' }),
      chooseDiagnosticTarget: async () => null,
      openDirectory: async () => undefined,
      quit: () => undefined,
    });

    const snapshots = await ipc.invoke(RECOVERY_CHANNELS.listSnapshots, 1) as Array<Record<string, unknown>>;
    assert.deepEqual(snapshots, [{
      id: '2026-08-31T100000Z-v1-to-v2-id', createdAt: '2026-08-31T10:00:00Z', schemaVersion: 1,
      appVersion: '0.3.2', sizeBytes: 123, sha256: 'a'.repeat(64), state: 'available',
    }]);
    assert.equal('fileName' in snapshots[0]!, false);
    assert.equal('quickCheck' in snapshots[0]!, false);
  });

  it('validates snapshot identifiers and serializes mutating operations', async () => {
    const ipc = new FakeIpc();
    let releaseRetry: (() => void) | undefined;
    let restores = 0;
    registerRecoveryIpc({
      ipc,
      senderId: 3,
      recovery: {
        listSnapshots: async () => [],
        restoreSnapshot: async (snapshotId) => { restores += 1; return { status: 'restored', snapshotId }; },
        exportDiagnostics: async () => undefined,
      },
      getFailure: startupFailure,
      retry: () => new Promise((resolve) => { releaseRetry = () => resolve({ status: 'ready' }); }),
      chooseDiagnosticTarget: async () => null,
      openDirectory: async () => undefined,
      quit: () => undefined,
    });

    const invalid = await ipc.invoke(RECOVERY_CHANNELS.restoreSnapshot, 3, '../escape') as { ok: boolean; error: { code: string } };
    assert.equal(invalid.ok, false);
    assert.equal(invalid.error.code, 'invalid_selection');
    assert.equal(restores, 0);

    const retry = ipc.invoke(RECOVERY_CHANNELS.retry, 3);
    const busy = await ipc.invoke(RECOVERY_CHANNELS.restoreSnapshot, 3, '2026-08-31T100000Z-v1-to-v2-id') as { ok: boolean; error: { code: string } };
    assert.equal(busy.error.code, 'not_available');
    releaseRetry?.();
    assert.deepEqual(await retry, { status: 'ready' });
  });

  it('contains storage and retry errors at the recovery boundary', async () => {
    const ipc = new FakeIpc();
    registerRecoveryIpc({
      ipc,
      senderId: 9,
      recovery: {
        listSnapshots: async () => { throw new Error('/private/database/path'); },
        restoreSnapshot: async () => { throw new Error('SQLite raw failure'); },
        exportDiagnostics: async () => { throw new Error('secret diagnostic failure'); },
      },
      getFailure: startupFailure,
      retry: async () => { throw new Error('private startup failure'); },
      chooseDiagnosticTarget: async () => '/tmp/diagnostic.json',
      openDirectory: async () => { throw new Error('/private/data'); },
      quit: () => { throw new Error('private quit failure'); },
    });

    assert.deepEqual(await ipc.invoke(RECOVERY_CHANNELS.listSnapshots, 9), []);
    const retry = JSON.stringify(await ipc.invoke(RECOVERY_CHANNELS.retry, 9));
    assert.doesNotMatch(retry, /private startup failure/u);
    const restore = JSON.stringify(await ipc.invoke(RECOVERY_CHANNELS.restoreSnapshot, 9, '2026-08-31T100000Z-v1-to-v2-id'));
    assert.doesNotMatch(restore, /SQLite raw failure/u);
    const exported = JSON.stringify(await ipc.invoke(RECOVERY_CHANNELS.exportDiagnostics, 9));
    assert.doesNotMatch(exported, /secret diagnostic failure/u);
    const opened = JSON.stringify(await ipc.invoke(RECOVERY_CHANNELS.openDataDirectory, 9));
    assert.doesNotMatch(opened, /private\/data/u);
    const quit = JSON.stringify(await ipc.invoke(RECOVERY_CHANNELS.quit, 9));
    assert.doesNotMatch(quit, /private quit failure/u);
  });
});
