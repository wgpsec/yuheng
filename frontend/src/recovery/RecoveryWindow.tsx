import { useEffect, useState } from 'react';
import { Archive, CheckCircle2, CircleAlert, Download, FolderOpen, LogOut, RefreshCw, RotateCcw, ShieldAlert, X } from 'lucide-react';
import type { RecoveryBridge, RecoverySnapshot, RecoveryStatus, StartupFailureCode } from '../contracts/desktop-bridge';
import { RecoveryController, type RecoveryAction, type RecoveryState } from './recovery-controller';

const FAILURE_LABELS: Record<StartupFailureCode, string> = {
  storage_unavailable: '数据目录不可用',
  database_corrupt: '数据完整性检查失败',
  schema_too_new: '数据版本高于当前应用',
  snapshot_failed: '迁移前快照创建失败',
  migration_failed: '数据迁移失败',
  verification_failed: '迁移后验证失败',
  initialization_failed: '应用初始化失败',
  interrupted_migration: '上次迁移未完成',
};
const FAILURE_MESSAGES: Record<StartupFailureCode, string> = {
  storage_unavailable: '数据目录暂时不可用。请检查磁盘空间和访问权限后重试。',
  database_corrupt: '数据完整性检查未通过。请选择可用快照恢复，或导出诊断。',
  schema_too_new: '当前数据由更新版本创建。请使用更新版本的玉衡打开。',
  snapshot_failed: '无法创建迁移前快照。请检查磁盘空间和访问权限后重试。',
  migration_failed: '数据迁移未完成。原数据已保留，可重试或恢复快照。',
  verification_failed: '迁移后的数据验证未通过。可恢复迁移前快照后重试。',
  initialization_failed: '应用初始化未完成。请重试；问题持续时导出诊断。',
  interrupted_migration: '检测到上次迁移未完成。请重试或恢复迁移前快照。',
};

const ACTION_LABELS: Record<RecoveryAction, string> = { retry: '重试启动', restore: '恢复快照', export: '导出诊断', 'open-data': '打开数据目录', 'open-log': '打开日志目录', quit: '退出玉衡' };

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '时间未知' : date.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
}

function FailureSummary({ failure }: { failure: RecoveryStatus['failure'] }) {
  return <div className="recovery-failure" role="alert">
    <CircleAlert size={20} aria-hidden="true" />
    <div><strong>{FAILURE_LABELS[failure.code] ?? '启动失败'}</strong><p>{FAILURE_MESSAGES[failure.code] ?? '启动检查失败，请重试或导出诊断。'}</p><small>诊断编号：{failure.diagnosticId}</small></div>
  </div>;
}

function SnapshotRow({ snapshot, selected, onSelect }: { snapshot: RecoverySnapshot; selected: boolean; onSelect: () => void }) {
  const unavailable = snapshot.state !== 'available';
  return <label className={`recovery-snapshot ${selected ? 'is-selected' : ''} ${unavailable ? 'is-unavailable' : ''}`}>
    <input type="radio" name="recovery-snapshot" checked={selected} disabled={unavailable} onChange={onSelect} />
    <Archive size={17} aria-hidden="true" />
    <span className="recovery-snapshot-copy"><strong>{formatDate(snapshot.createdAt)}</strong><small>Schema {snapshot.schemaVersion} · {formatBytes(snapshot.sizeBytes)} · {snapshot.state === 'available' ? '可恢复' : snapshot.state === 'restored' ? '已恢复' : '不可用'}</small></span>
    {selected && <CheckCircle2 size={17} aria-hidden="true" />}
  </label>;
}

function RecoveryActions({ controller, state }: { controller: RecoveryController; state: RecoveryState }) {
  const busy = state.busyAction;
  const run = (action: Exclude<RecoveryAction, 'retry' | 'restore'>) => { void controller.runAction(action); };
  return <div className="recovery-actions">
    <button type="button" className="recovery-button recovery-button-primary" onClick={() => void controller.retry()} disabled={Boolean(busy)}><RefreshCw size={16} aria-hidden="true" className={busy === 'retry' ? 'is-spinning' : ''} />{busy === 'retry' ? '检查中…' : ACTION_LABELS.retry}</button>
    <button type="button" className="recovery-button" onClick={() => run('export')} disabled={Boolean(busy)}><Download size={16} aria-hidden="true" />{busy === 'export' ? '导出中…' : ACTION_LABELS.export}</button>
    <button type="button" className="recovery-button" onClick={() => run('open-data')} disabled={Boolean(busy)}><FolderOpen size={16} aria-hidden="true" />数据目录</button>
    <button type="button" className="recovery-button" onClick={() => run('open-log')} disabled={Boolean(busy)}><FolderOpen size={16} aria-hidden="true" />日志目录</button>
    <button type="button" className="recovery-button recovery-button-quiet" onClick={() => run('quit')} disabled={Boolean(busy)}><LogOut size={16} aria-hidden="true" />{busy === 'quit' ? '退出中…' : ACTION_LABELS.quit}</button>
  </div>;
}

export function RecoveryWindow({ bridge }: { bridge?: RecoveryBridge }) {
  const [controller] = useState(() => bridge ? new RecoveryController(bridge) : null);
  const [state, setState] = useState<RecoveryState>(() => controller?.getState() ?? { status: null, startupReady: false, snapshots: [], selectedSnapshotId: null, confirmationOpen: false, loading: false, busyAction: null, error: '恢复服务尚未连接。', actionError: null, notice: null });

  useEffect(() => {
    if (!controller) return;
    const unsubscribe = controller.subscribe(setState);
    void controller.initialize();
    return () => { unsubscribe(); controller.dispose(); };
  }, [controller]);

  if (!controller) return <main className="recovery-window"><div className="recovery-card recovery-card-unavailable"><ShieldAlert size={32} aria-hidden="true" /><h1>无法打开恢复模式</h1><p>恢复服务尚未连接。请退出后重新启动玉衡。</p></div></main>;
  const failure = state.status?.failure;
  const selectedSnapshot = state.snapshots.find((snapshot) => snapshot.id === state.selectedSnapshotId);
  const isReady = state.startupReady;
  return <main className="recovery-window">
    <div className="recovery-card">
      <header className="recovery-header"><div className="recovery-brand"><span className="recovery-brand-mark">玉</span><div><span className="recovery-eyebrow">启动恢复</span><h1>恢复玉衡</h1></div></div><span className={`recovery-state-pill ${isReady ? 'is-ready' : ''}`}>{isReady ? <><CheckCircle2 size={14} />已就绪</> : <><ShieldAlert size={14} />需要处理</>}</span></header>
      {state.loading && <div className="recovery-loading" role="status"><RefreshCw size={18} className="is-spinning" />正在检查应用状态…</div>}
      {state.error && <div className="recovery-inline-error" role="alert">{state.error}</div>}
      {isReady ? <section className="recovery-ready" role="status"><CheckCircle2 size={30} /><h2>启动检查已通过</h2><p>可以关闭此窗口，然后重新打开玉衡进入工作区。</p></section> : <>
        {failure && <FailureSummary failure={failure} />}
        {state.status && <div className="recovery-meta"><span>当前 Schema <strong>{state.status.currentSchemaVersion}</strong></span><span>目标 Schema <strong>{state.status.targetSchemaVersion}</strong></span>{state.status.attemptId && <span>本次尝试 <strong>{state.status.attemptId}</strong></span>}</div>}
        <section className="recovery-section"><div className="recovery-section-heading"><div><h2>选择恢复快照</h2><p>恢复前会保留当前失败数据，不会覆盖唯一副本。</p></div><button type="button" className="recovery-icon-button" onClick={() => void controller.initialize()} disabled={Boolean(state.busyAction)} aria-label="刷新快照" title="刷新快照"><RotateCcw size={16} /></button></div>
          {state.snapshots.length === 0 ? <div className="recovery-empty"><Archive size={20} /><span>没有可用的迁移前快照</span></div> : <div className="recovery-snapshot-list">{state.snapshots.map((snapshot) => <SnapshotRow key={snapshot.id} snapshot={snapshot} selected={snapshot.id === state.selectedSnapshotId} onSelect={() => controller.selectSnapshot(snapshot.id)} />)}</div>}
          <button type="button" className="recovery-button recovery-restore-button" onClick={() => state.confirmationOpen ? void controller.restoreSelected() : controller.openRestoreConfirmation()} disabled={!selectedSnapshot || Boolean(state.busyAction)}><Archive size={16} aria-hidden="true" />{state.busyAction === 'restore' ? '恢复中…' : state.confirmationOpen ? '确认恢复此快照' : ACTION_LABELS.restore}</button>
          {state.confirmationOpen && selectedSnapshot && <div className="recovery-confirmation" role="alertdialog" aria-label="确认恢复快照"><strong>确定恢复这个快照？</strong><p>当前失败数据库会先移动到隔离目录，恢复完成后需要重新启动玉衡。</p><div><button type="button" className="recovery-button recovery-button-primary" onClick={() => void controller.restoreSelected()}>确认恢复</button><button type="button" className="recovery-button" onClick={() => controller.cancelRestore()}><X size={15} />取消</button></div></div>}
        </section>
      </>}
      {state.actionError && <div className="recovery-action-error" role="alert">{state.actionError.message}</div>}
      {state.notice && <div className="recovery-action-notice" role="status">{state.notice}</div>}
      <RecoveryActions controller={controller} state={state} />
      <footer className="recovery-footer">恢复模式仅使用受限恢复接口，不会启动会话、任务、Provider 或工具运行时。</footer>
    </div>
  </main>;
}
