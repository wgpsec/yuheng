import assert from 'node:assert/strict';
import test from 'node:test';
import type { RecoveryBridge, RecoverySnapshot, RecoveryStatus } from '../frontend/src/contracts/desktop-bridge';
import { RecoveryController } from '../frontend/src/recovery/recovery-controller';

const status = (diagnosticId = 'diag-1'): RecoveryStatus => ({ state: 'recovery_required', failure: { code: 'database_corrupt', phase: 'checking', retryable: true, currentSchemaVersion: 1, targetSchemaVersion: 2, diagnosticId, message: '数据完整性检查失败，请恢复快照或重试。' }, currentSchemaVersion: 1, targetSchemaVersion: 2, attemptId: 'attempt-1' });
const snapshot: RecoverySnapshot = { id: 'snapshot-1', createdAt: '2026-08-31T00:00:00.000Z', schemaVersion: 1, appVersion: '0.3.2', sizeBytes: 1024 * 1024, sha256: 'redacted-hash', state: 'available' };
const ok = (): { ok: true } => ({ ok: true });

function bridge(overrides: Partial<RecoveryBridge> = {}): RecoveryBridge {
  return { getStatus: async () => status(), retry: async () => ({ status: 'recovery_required', recovery: status() }), listSnapshots: async () => [snapshot], restoreSnapshot: async () => ok(), exportDiagnostics: async () => ok(), openDataDirectory: async () => ok(), openLogDirectory: async () => ok(), quit: async () => ok(), ...overrides };
}

test('loads typed failure and snapshots without exposing raw bridge details', async () => {
  const controller = new RecoveryController(bridge({ getStatus: async () => ({ ...status(), failure: { ...status().failure!, message: 'SQLiteError: /Users/alice/Library/Application Support/yuheng/data.db' } }) }));
  await controller.initialize();
  assert.equal(controller.getState().status?.failure?.code, 'database_corrupt');
  assert.equal(controller.getState().status?.failure?.message, '数据完整性检查未通过。请选择可用快照恢复，或导出诊断。');
  assert.deepEqual(controller.getState().snapshots.map((item) => item.id), ['snapshot-1']);
  controller.selectSnapshot('missing');
  assert.equal(controller.getState().selectedSnapshotId, null);
});

test('restore requires selection and explicit confirmation', async () => {
  let restoreCalls = 0;
  const controller = new RecoveryController(bridge({ restoreSnapshot: async () => { restoreCalls += 1; return ok(); } }));
  await controller.initialize();
  await controller.restoreSelected();
  assert.equal(restoreCalls, 0);
  controller.selectSnapshot('snapshot-1');
  assert.equal(controller.openRestoreConfirmation(), true);
  await controller.restoreSelected();
  assert.equal(restoreCalls, 1);
  assert.equal(controller.getState().confirmationOpen, false);
});

test('retry ignores a stale status response after a newer initialize', async () => {
  let resolveFirst!: (value: RecoveryStatus) => void;
  let calls = 0;
  const first = new Promise<RecoveryStatus>((resolve) => { resolveFirst = resolve; });
  const controller = new RecoveryController(bridge({ getStatus: async () => { calls += 1; return calls === 1 ? first : status('diag-new'); } }));
  const initial = controller.initialize();
  await controller.initialize();
  resolveFirst(status('diag-old'));
  await initial;
  assert.equal(controller.getState().status?.failure?.diagnosticId, 'diag-new');
});

test('restore failure keeps selected snapshot and returns stable operation error', async () => {
  const controller = new RecoveryController(bridge({ restoreSnapshot: async () => ({ ok: false, error: { code: 'restore_failed', message: '恢复快照失败，原数据仍已保留。' } }) }));
  await controller.initialize();
  controller.selectSnapshot('snapshot-1');
  controller.openRestoreConfirmation();
  await controller.restoreSelected();
  assert.equal(controller.getState().selectedSnapshotId, 'snapshot-1');
  assert.equal(controller.getState().actionError?.code, 'restore_failed');
});

test('successful diagnostic export produces renderer feedback without exposing a path', async () => {
  const controller = new RecoveryController(bridge({ exportDiagnostics: async () => ({ ok: true }) }));
  await controller.initialize();
  await controller.runAction('export');
  assert.equal(controller.getState().notice, '诊断已导出。');
  assert.equal(controller.getState().actionError, null);
});

test('disposed controller ignores late results and clears listeners', async () => {
  let resolveStatus!: (value: RecoveryStatus) => void;
  const controller = new RecoveryController(bridge({ getStatus: () => new Promise((resolve) => { resolveStatus = resolve; }) }));
  let updates = 0;
  controller.subscribe(() => { updates += 1; });
  const load = controller.initialize();
  controller.dispose();
  resolveStatus(status('late'));
  await load;
  assert.equal(controller.getState().status, null);
  assert.equal(updates, 2); // initial subscription plus loading event before disposal
});
