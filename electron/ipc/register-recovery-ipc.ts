import type { StartupFailure } from '../app/startup-result';
import { RECOVERY_CHANNELS } from '../recovery-channels';
import type { RecoverySnapshot, StorageRecovery } from '../storage/recovery-types';

type RecoveryPhase = 'preflight' | 'checking' | 'snapshotting' | 'migrating' | 'verifying' | 'initializing';
type RendererRecoveryStatus = {
  state: 'recovery_required';
  failure: {
    code: StartupFailure['code'];
    phase: RecoveryPhase;
    retryable: boolean;
    currentSchemaVersion: number;
    targetSchemaVersion: number;
    diagnosticId: string;
    message: string;
  };
  currentSchemaVersion: number;
  targetSchemaVersion: number;
  attemptId: string | null;
};
type RendererRecoverySnapshot = {
  id: string;
  createdAt: string;
  schemaVersion: number;
  appVersion: string;
  sizeBytes: number;
  sha256: string;
  state: 'available' | 'restored' | 'invalid';
};
type OperationCode = 'not_available' | 'invalid_selection' | 'restore_failed' | 'export_failed' | 'directory_unavailable' | 'quit_failed';
type OperationResult = { ok: true; path?: string } | { ok: false; error: { code: OperationCode; message: string } };

export type RecoveryIpcEvent = { sender: { id: number } };
export type RecoveryIpcRegistrar = {
  handle(channel: string, listener: (event: RecoveryIpcEvent, ...args: unknown[]) => unknown): void;
  removeHandler(channel: string): void;
};
export type RecoveryRetryOutcome =
  | { status: 'ready' }
  | { status: 'recovery_required'; failure: StartupFailure };

export type RegisterRecoveryIpcOptions = {
  ipc: RecoveryIpcRegistrar;
  senderId: number;
  recovery: StorageRecovery;
  getFailure(): StartupFailure;
  retry(): Promise<RecoveryRetryOutcome>;
  chooseDiagnosticTarget(): Promise<string | null>;
  openDirectory(directory: 'data' | 'logs'): Promise<void>;
  quit(): void;
};

const SNAPSHOT_ID = /^[0-9A-Za-z][0-9A-Za-z.TZ_-]{0,199}$/u;

export function registerRecoveryIpc(options: RegisterRecoveryIpcOptions): () => void {
  let disposed = false;
  let mutation: Promise<unknown> | null = null;
  const register = (channel: string, handler: (...args: unknown[]) => unknown): void => {
    options.ipc.handle(channel, (event, ...args) => {
      if (disposed || event.sender.id !== options.senderId) throw new Error('IPC sender is not authorized for recovery operations.');
      return handler(...args);
    });
  };

  register(RECOVERY_CHANNELS.getStatus, () => recoveryStatus(options.getFailure()));
  register(RECOVERY_CHANNELS.listSnapshots, async () => {
    try { return (await options.recovery.listSnapshots()).map(rendererSnapshot); }
    catch { return []; }
  });
  register(RECOVERY_CHANNELS.retry, () => runExclusive(async () => {
    try {
      const result = await options.retry();
      return result.status === 'ready'
        ? { status: 'ready' as const }
        : { status: 'recovery_required' as const, recovery: recoveryStatus(result.failure) };
    } catch {
      return { status: 'recovery_required' as const, recovery: recoveryStatus(options.getFailure()) };
    }
  }));
  register(RECOVERY_CHANNELS.restoreSnapshot, (rawSnapshotId) => runExclusive(async (): Promise<OperationResult> => {
    if (typeof rawSnapshotId !== 'string' || !SNAPSHOT_ID.test(rawSnapshotId)) return failure('invalid_selection');
    try {
      await options.recovery.restoreSnapshot(rawSnapshotId);
      return { ok: true };
    } catch {
      return failure('restore_failed');
    }
  }));
  register(RECOVERY_CHANNELS.exportDiagnostics, async (): Promise<OperationResult> => {
    try {
      const target = await options.chooseDiagnosticTarget();
      if (!target) return { ok: true };
      await options.recovery.exportDiagnostics(options.getFailure().diagnosticId, target);
      return { ok: true };
    } catch {
      return failure('export_failed');
    }
  });
  register(RECOVERY_CHANNELS.openDataDirectory, () => openDirectory('data'));
  register(RECOVERY_CHANNELS.openLogDirectory, () => openDirectory('logs'));
  register(RECOVERY_CHANNELS.quit, (): OperationResult => {
    try {
      options.quit();
      return { ok: true };
    } catch {
      return failure('quit_failed');
    }
  });

  function runExclusive<T>(operation: () => Promise<T>): Promise<T | OperationResult> {
    if (mutation) return Promise.resolve(failure('not_available'));
    const current = operation();
    mutation = current;
    void current.then(
      () => { if (mutation === current) mutation = null; },
      () => { if (mutation === current) mutation = null; },
    );
    return current;
  }

  async function openDirectory(directory: 'data' | 'logs'): Promise<OperationResult> {
    try {
      await options.openDirectory(directory);
      return { ok: true };
    } catch {
      return failure('directory_unavailable');
    }
  }

  return () => {
    if (disposed) return;
    disposed = true;
    for (const channel of Object.values(RECOVERY_CHANNELS)) options.ipc.removeHandler(channel);
  };
}

function recoveryStatus(failureValue: StartupFailure): RendererRecoveryStatus {
  const currentSchemaVersion = failureValue.currentSchemaVersion ?? 0;
  const targetSchemaVersion = failureValue.targetSchemaVersion ?? 0;
  return {
    state: 'recovery_required',
    failure: {
      code: failureValue.code,
      phase: recoveryPhase(failureValue.stage),
      retryable: failureValue.retryable,
      currentSchemaVersion,
      targetSchemaVersion,
      diagnosticId: failureValue.diagnosticId,
      message: failureValue.userMessage,
    },
    currentSchemaVersion,
    targetSchemaVersion,
    attemptId: null,
  };
}

function rendererSnapshot(snapshot: RecoverySnapshot): RendererRecoverySnapshot {
  return {
    id: snapshot.id,
    createdAt: snapshot.createdAt,
    schemaVersion: snapshot.sourceVersion,
    appVersion: snapshot.appVersion,
    sizeBytes: snapshot.originalDatabaseSize,
    sha256: snapshot.sha256,
    state: snapshot.status === 'verified' ? 'available' : snapshot.status === 'restored' ? 'restored' : 'invalid',
  };
}

function recoveryPhase(stage: StartupFailure['stage']): RecoveryPhase {
  return stage === 'starting' ? 'preflight' : stage;
}

function failure(code: OperationCode): OperationResult {
  const messages: Record<OperationCode, string> = {
    not_available: '恢复服务正忙，请稍后重试。',
    invalid_selection: '请选择一个可用的恢复快照。',
    restore_failed: '恢复快照失败，原数据仍已保留。',
    export_failed: '导出诊断失败，请重试。',
    directory_unavailable: '目录暂时无法打开，请重试。',
    quit_failed: '退出失败，请稍后重试。',
  };
  return { ok: false, error: { code, message: messages[code] } };
}
