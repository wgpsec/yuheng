import type {
  RecoveryBridge,
  RecoveryOperationError,
  RecoveryOperationResult,
  RecoveryRetryResult,
  RecoverySnapshot,
  RecoveryStatus,
  StartupFailureCode,
} from '../contracts/desktop-bridge';

export type RecoveryAction = 'retry' | 'restore' | 'export' | 'open-data' | 'open-log' | 'quit';
export type RecoveryState = {
  status: RecoveryStatus | null;
  startupReady: boolean;
  snapshots: RecoverySnapshot[];
  selectedSnapshotId: string | null;
  confirmationOpen: boolean;
  loading: boolean;
  busyAction: RecoveryAction | null;
  error: string | null;
  actionError: RecoveryOperationError | null;
  notice: string | null;
};

export const initialRecoveryState = (): RecoveryState => ({
  status: null,
  startupReady: false,
  snapshots: [],
  selectedSnapshotId: null,
  confirmationOpen: false,
  loading: true,
  busyAction: null,
  error: null,
  actionError: null,
  notice: null,
});

export type RecoveryStateEvent =
  | { type: 'status'; status: RecoveryStatus }
  | { type: 'ready' }
  | { type: 'snapshots'; snapshots: RecoverySnapshot[] }
  | { type: 'select'; snapshotId: string | null }
  | { type: 'confirm'; open: boolean }
  | { type: 'loading'; loading: boolean }
  | { type: 'busy'; action: RecoveryAction | null }
  | { type: 'error'; message: string | null }
  | { type: 'action-error'; error: RecoveryOperationError | null }
  | { type: 'notice'; message: string | null };

export function reduceRecoveryState(state: RecoveryState, event: RecoveryStateEvent): RecoveryState {
  switch (event.type) {
    case 'status': return { ...state, status: event.status, startupReady: false, loading: false, error: null };
    case 'ready': return { ...state, startupReady: true, loading: false, error: null };
    case 'snapshots': return { ...state, snapshots: event.snapshots };
    case 'select': return { ...state, selectedSnapshotId: event.snapshotId, confirmationOpen: false, actionError: null };
    case 'confirm': return { ...state, confirmationOpen: event.open };
    case 'loading': return { ...state, loading: event.loading };
    case 'busy': return { ...state, busyAction: event.action };
    case 'error': return { ...state, error: event.message, loading: false };
    case 'action-error': return { ...state, actionError: event.error };
    case 'notice': return { ...state, notice: event.message };
  }
}

const safeErrorMessage = (reason: unknown, fallback: string): string => {
  // Do not put raw SQLite, filesystem, paths, or stack details into the recovery UI.
  return reason && typeof reason === 'object' && 'message' in reason && typeof (reason as { message?: unknown }).message === 'string'
    ? fallback
    : fallback;
};

const SAFE_OPERATION_MESSAGES: Record<RecoveryOperationError['code'], string> = {
  not_available: '恢复服务暂时不可用，请重试或导出诊断。',
  invalid_selection: '请选择一个可用的恢复快照。',
  restore_failed: '恢复快照失败，原数据仍已保留。',
  export_failed: '导出诊断失败，请重试。',
  directory_unavailable: '目录暂时无法打开，请重试。',
  quit_failed: '退出失败，请稍后重试。',
};
const safeOperationError = (error: RecoveryOperationError): RecoveryOperationError => ({ code: error.code, message: SAFE_OPERATION_MESSAGES[error.code] ?? '操作失败，请重试。' });
const SAFE_FAILURE_MESSAGES: Record<StartupFailureCode, string> = {
  storage_unavailable: '数据目录暂时不可用。请检查磁盘空间和访问权限后重试。',
  database_corrupt: '数据完整性检查未通过。请选择可用快照恢复，或导出诊断。',
  schema_too_new: '当前数据由更新版本创建。请使用更新版本的玉衡打开。',
  snapshot_failed: '无法创建迁移前快照。请检查磁盘空间和访问权限后重试。',
  migration_failed: '数据迁移未完成。原数据已保留，可重试或恢复快照。',
  verification_failed: '迁移后的数据验证未通过。可恢复迁移前快照后重试。',
  initialization_failed: '应用初始化未完成。请重试；问题持续时导出诊断。',
  interrupted_migration: '检测到上次迁移未完成。请重试或恢复迁移前快照。',
};
const safeStatus = (status: RecoveryStatus): RecoveryStatus => status.failure ? { ...status, failure: { ...status.failure, message: SAFE_FAILURE_MESSAGES[status.failure.code] ?? '启动检查失败，请重试或导出诊断。' } } : status;

export class RecoveryController {
  private state = initialRecoveryState();
  private listeners = new Set<(state: RecoveryState) => void>();
  private requestVersion = 0;
  private disposed = false;

  constructor(private readonly bridge: RecoveryBridge) {}

  getState(): RecoveryState { return this.state; }

  subscribe(listener: (state: RecoveryState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.disposed = true;
    this.requestVersion += 1;
    this.listeners.clear();
  }

  private emit(event: RecoveryStateEvent): void {
    if (this.disposed) return;
    this.state = reduceRecoveryState(this.state, event);
    this.listeners.forEach((listener) => listener(this.state));
  }

  private async loadSnapshots(version: number): Promise<void> {
    try {
      const snapshots = await this.bridge.listSnapshots();
      if (!this.disposed && version === this.requestVersion) this.emit({ type: 'snapshots', snapshots });
    } catch {
      if (!this.disposed && version === this.requestVersion) this.emit({ type: 'snapshots', snapshots: [] });
    }
  }

  async initialize(): Promise<void> {
    // React StrictMode may replay an effect setup after its simulated cleanup.
    this.disposed = false;
    const version = ++this.requestVersion;
    this.emit({ type: 'loading', loading: true });
    try {
      const status = await this.bridge.getStatus();
      if (this.disposed || version !== this.requestVersion) return;
      this.emit({ type: 'status', status: safeStatus(status) });
      await this.loadSnapshots(version);
    } catch (reason) {
      if (!this.disposed && version === this.requestVersion) this.emit({ type: 'error', message: safeErrorMessage(reason, '无法读取恢复状态，请重试。') });
    }
  }

  selectSnapshot(snapshotId: string | null): void {
    const valid = snapshotId && this.state.snapshots.some((snapshot) => snapshot.id === snapshotId && snapshot.state === 'available');
    this.emit({ type: 'select', snapshotId: valid ? snapshotId : null });
  }

  openRestoreConfirmation(): boolean {
    if (!this.state.selectedSnapshotId || this.state.busyAction) return false;
    this.emit({ type: 'confirm', open: true });
    return true;
  }

  cancelRestore(): void { this.emit({ type: 'confirm', open: false }); }

  async retry(): Promise<void> {
    if (this.state.busyAction) return;
    const version = ++this.requestVersion;
    this.emit({ type: 'busy', action: 'retry' });
    this.emit({ type: 'action-error', error: null });
    this.emit({ type: 'notice', message: null });
    try {
      const result: RecoveryRetryResult = await this.bridge.retry();
      if (this.disposed || version !== this.requestVersion) return;
      if (result.status === 'ready') this.emit({ type: 'ready' });
      else this.emit({ type: 'status', status: safeStatus(result.recovery) });
      await this.loadSnapshots(version);
    } catch (reason) {
      if (!this.disposed && version === this.requestVersion) this.emit({ type: 'action-error', error: { code: 'not_available', message: safeErrorMessage(reason, '重试启动失败，请导出诊断后联系管理员。') } });
    } finally {
      if (!this.disposed && version === this.requestVersion) this.emit({ type: 'busy', action: null });
    }
  }

  async restoreSelected(): Promise<void> {
    const snapshotId = this.state.selectedSnapshotId;
    if (!snapshotId || !this.state.confirmationOpen || this.state.busyAction) return;
    const version = ++this.requestVersion;
    this.emit({ type: 'busy', action: 'restore' });
    this.emit({ type: 'confirm', open: false });
    this.emit({ type: 'action-error', error: null });
    this.emit({ type: 'notice', message: null });
    try {
      const result = await this.bridge.restoreSnapshot(snapshotId);
      if (this.disposed || version !== this.requestVersion) return;
      if (!result.ok) this.emit({ type: 'action-error', error: safeOperationError(result.error) });
      else {
        this.emit({ type: 'notice', message: '快照已恢复，请重新启动玉衡。' });
        const status = await this.bridge.getStatus();
        if (!this.disposed && version === this.requestVersion) this.emit({ type: 'status', status: safeStatus(status) });
      }
    } catch (reason) {
      if (!this.disposed && version === this.requestVersion) this.emit({ type: 'action-error', error: { code: 'restore_failed', message: safeErrorMessage(reason, '恢复快照失败，原数据仍已保留。') } });
    } finally {
      if (!this.disposed && version === this.requestVersion) this.emit({ type: 'busy', action: null });
    }
  }

  async runAction(action: Exclude<RecoveryAction, 'retry' | 'restore'>): Promise<RecoveryOperationResult | undefined> {
    if (this.state.busyAction) return undefined;
    const version = ++this.requestVersion;
    this.emit({ type: 'busy', action });
    this.emit({ type: 'action-error', error: null });
    this.emit({ type: 'notice', message: null });
    const operation = action === 'export' ? () => this.bridge.exportDiagnostics()
      : action === 'open-data' ? () => this.bridge.openDataDirectory()
        : action === 'open-log' ? () => this.bridge.openLogDirectory() : () => this.bridge.quit();
    try {
      const result = await operation();
      if (!this.disposed && version === this.requestVersion) {
        if (!result.ok) this.emit({ type: 'action-error', error: safeOperationError(result.error) });
        else if (action === 'export') this.emit({ type: 'notice', message: '诊断已导出。' });
        else if (action === 'open-data') this.emit({ type: 'notice', message: '已打开数据目录。' });
        else if (action === 'open-log') this.emit({ type: 'notice', message: '已打开日志目录。' });
      }
      return result;
    } catch (reason) {
      const error: RecoveryOperationError = { code: action === 'export' ? 'export_failed' : action === 'quit' ? 'quit_failed' : 'directory_unavailable', message: safeErrorMessage(reason, '操作失败，请重试。') };
      if (!this.disposed && version === this.requestVersion) this.emit({ type: 'action-error', error });
      return { ok: false, error };
    } finally {
      if (!this.disposed && version === this.requestVersion) this.emit({ type: 'busy', action: null });
    }
  }
}
