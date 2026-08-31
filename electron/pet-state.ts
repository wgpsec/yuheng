export type PetState = 'idle' | 'thinking' | 'working' | 'attention' | 'error' | 'celebrate';

export const PET_STATES: readonly PetState[] = [
  'idle',
  'thinking',
  'working',
  'attention',
  'error',
  'celebrate',
];

export function isPetState(value: unknown): value is PetState {
  return typeof value === 'string' && (PET_STATES as readonly string[]).includes(value);
}

export type PetRunEvent = {
  type: string;
  runId?: string;
  conversationId?: string;
  messageId?: string;
  approvalId?: string;
  toolName?: string;
  approved?: boolean;
  isError?: boolean;
};

export type PetRunTarget = { runId: string; conversationId?: string };
export type PetOpenTarget =
  | { kind: 'conversation'; conversationId: string; runId?: string; messageId?: string }
  | { kind: 'run'; conversationId: string; runId: string }
  | { kind: 'approval'; conversationId: string; runId: string; approvalId: string }
  | { kind: 'task'; boardId: string; taskId: string };

export function parsePetOpenTarget(value: unknown): PetOpenTarget | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Record<string, unknown>;
  const boardId = safeTargetId(input.boardId);
  const taskId = safeTargetId(input.taskId);
  if (input.kind === 'task') return boardId && taskId ? { kind: 'task', boardId, taskId } : undefined;
  const conversationId = safeTargetId(input.conversationId);
  if (!conversationId) return undefined;
  const runId = safeTargetId(input.runId);
  if (input.kind === 'run') return runId ? { kind: 'run', conversationId, runId } : undefined;
  if (input.kind === 'approval') {
    const approvalId = safeTargetId(input.approvalId);
    return runId && approvalId ? { kind: 'approval', conversationId, runId, approvalId } : undefined;
  }
  if (input.kind !== 'conversation') return undefined;
  const messageId = safeTargetId(input.messageId);
  return {
    kind: 'conversation',
    conversationId,
    ...(runId ? { runId } : {}),
    ...(messageId ? { messageId } : {}),
  };
}

function safeTargetId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= 256 ? trimmed : undefined;
}

export type PetFeedback = {
  state: PetState;
  label: string;
  kind?: 'task_reminder';
  detail?: string;
  conversationId?: string;
  runId?: string;
  toolName?: string;
  openTarget?: PetOpenTarget;
};

/** Parse the small, non-sensitive feedback payload accepted by the Pet window. */
export function parsePetFeedback(value: unknown): PetFeedback | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Record<string, unknown>;
  if (!isPetState(input.state) || typeof input.label !== 'string') return undefined;
  const label = safeFeedbackText(input.label, 160);
  if (!label) return undefined;
  const detail = safeFeedbackText(input.detail, 160);
  const conversationId = safeTargetId(input.conversationId);
  const runId = safeTargetId(input.runId);
  const toolName = safeFeedbackText(input.toolName, 96);
  const openTarget = parsePetOpenTarget(input.openTarget);
  return {
    state: input.state,
    label,
    ...(input.kind === 'task_reminder' ? { kind: 'task_reminder' as const } : {}),
    ...(detail ? { detail } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(runId ? { runId } : {}),
    ...(toolName ? { toolName } : {}),
    ...(openTarget ? { openTarget } : {}),
  };
}

/** Map runtime events to the small state vocabulary understood by the Pet window. */
export function petStateForRunEvent(event: PetRunEvent): PetState | null {
  switch (event.type) {
    case 'accepted':
      return 'thinking';
    case 'delta':
    case 'tool_end':
      return event.isError === true ? 'error' : 'thinking';
    case 'tool_start':
      return 'working';
    case 'approval_required':
      return 'attention';
    case 'approval_resolved':
      return event.approved === true ? 'thinking' : 'attention';
    case 'completed':
      return 'celebrate';
    case 'failed':
      return 'error';
    case 'cancelled':
      return 'idle';
    default:
      return null;
  }
}

const PET_STATE_PRIORITY: Record<PetState, number> = {
  idle: 10,
  thinking: 20,
  working: 30,
  attention: 40,
  error: 50,
  celebrate: 60,
};

const DEFAULT_CELEBRATE_DURATION_MS = 1_400;
const DEFAULT_ERROR_DURATION_MS = 4_000;
const CANCELLED_RUN_RETENTION_MS = 60_000;

type CoordinatedRun = {
  state: PetState;
  updatedAt: number;
  runId: string;
  conversationId?: string;
  terminal: boolean;
  stateExpiresAt?: number;
  terminalExpiresAt?: number;
};

export type PetStateCoordinatorOptions = {
  celebrateDurationMs?: number;
  errorDurationMs?: number;
  onStateChange?: (state: PetState) => void;
};

/**
 * Aggregates run events into one deterministic state for the desktop Pet.
 * Each run is tracked independently so one session cannot hide another's work.
 */
export class PetStateCoordinator {
  private readonly runs = new Map<string, CoordinatedRun>();
  private readonly celebrateDurationMs: number;
  private readonly errorDurationMs: number;
  private readonly onStateChange?: (state: PetState) => void;
  private currentState: PetState = 'idle';

  constructor(options: PetStateCoordinatorOptions = {}) {
    this.celebrateDurationMs = positiveDuration(options.celebrateDurationMs, DEFAULT_CELEBRATE_DURATION_MS);
    this.errorDurationMs = positiveDuration(options.errorDurationMs, DEFAULT_ERROR_DURATION_MS);
    this.onStateChange = options.onStateChange;
  }

  getState(): PetState {
    return this.currentState;
  }

  /** Return the run currently represented by the aggregate Pet state. */
  getFocusTarget(now = Date.now()): PetRunTarget | undefined {
    const focused = this.focusedRun(now);
    if (!focused) return undefined;
    return { runId: focused.runId, ...(focused.conversationId ? { conversationId: focused.conversationId } : {}) };
  }

  /** Apply a run event and return the resulting aggregate state. */
  update(event: PetRunEvent, now = Date.now()): PetState {
    this.expire(now);
    const runId = typeof event.runId === 'string' && event.runId.trim() ? event.runId : undefined;
    const nextState = petStateForRunEvent(event);
    if (!runId || !nextState) return this.currentState;

    const previous = this.runs.get(runId);
    if (previous?.terminal) return this.currentState;
    const conversationId = event.conversationId ?? previous?.conversationId;

    if (event.type === 'cancelled') {
      this.runs.set(runId, {
        state: 'idle',
        updatedAt: now,
        runId,
        ...(conversationId ? { conversationId } : {}),
        terminal: true,
        stateExpiresAt: now,
        terminalExpiresAt: now + CANCELLED_RUN_RETENTION_MS,
      });
    } else if (event.type === 'completed') {
      this.runs.set(runId, {
        state: 'celebrate',
        updatedAt: now,
        runId,
        ...(conversationId ? { conversationId } : {}),
        terminal: true,
        stateExpiresAt: now + this.celebrateDurationMs,
        terminalExpiresAt: now + CANCELLED_RUN_RETENTION_MS,
      });
    } else if (event.type === 'failed') {
      this.runs.set(runId, {
        state: 'error',
        updatedAt: now,
        runId,
        ...(conversationId ? { conversationId } : {}),
        terminal: true,
        stateExpiresAt: now + this.errorDurationMs,
        terminalExpiresAt: now + CANCELLED_RUN_RETENTION_MS,
      });
    } else {
      this.runs.set(runId, { state: nextState, updatedAt: now, runId, ...(conversationId ? { conversationId } : {}), terminal: false });
    }
    return this.recompute(now);
  }

  /** Remove expired terminal states and return the resulting aggregate state. */
  expire(now = Date.now()): PetState {
    for (const [runId, run] of this.runs) {
      if (run.terminalExpiresAt !== undefined && run.terminalExpiresAt <= now) this.runs.delete(runId);
    }
    return this.recompute(now);
  }

  /** Used by the main process to schedule the next TTL wake-up. */
  nextExpiryAt(): number | undefined {
    let next: number | undefined;
    for (const run of this.runs.values()) {
      for (const expiresAt of [run.stateExpiresAt, run.terminalExpiresAt]) {
        if (expiresAt === undefined) continue;
        if (next === undefined || expiresAt < next) next = expiresAt;
      }
    }
    return next;
  }

  private recompute(now: number): PetState {
    const focused = this.focusedRun(now);
    const nextState = focused?.state ?? 'idle';
    if (nextState !== this.currentState) {
      this.currentState = nextState;
      this.onStateChange?.(nextState);
    }
    return this.currentState;
  }

  private focusedRun(now: number): CoordinatedRun | undefined {
    let focused: CoordinatedRun | undefined;
    for (const run of this.runs.values()) {
      if (run.stateExpiresAt !== undefined && run.stateExpiresAt <= now) continue;
      if (!focused) {
        focused = run;
        continue;
      }
      const priority = PET_STATE_PRIORITY[run.state];
      const focusedPriority = PET_STATE_PRIORITY[focused.state];
      if (priority > focusedPriority || (priority === focusedPriority && run.updatedAt > focused.updatedAt)) focused = run;
    }
    return focused;
  }
}

function positiveDuration(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

const PET_STATE_LABELS: Record<PetState, string> = {
  idle: '已就绪',
  thinking: '正在思考',
  working: '正在执行',
  attention: '需要确认',
  error: '执行失败',
  celebrate: '已完成',
};

export function petFeedbackForState(state: PetState, target?: PetRunTarget): PetFeedback {
  return {
    state,
    label: PET_STATE_LABELS[state],
    ...(target?.conversationId ? { conversationId: target.conversationId } : {}),
    ...(target?.runId ? { runId: target.runId } : {}),
  };
}

/** Build concise, non-sensitive copy for the floating Pet bubble. */
export function petFeedbackForRunEvent(event: PetRunEvent, state: PetState, target?: PetRunTarget): PetFeedback {
  const eventTarget = event.runId ? { runId: event.runId, ...(event.conversationId ? { conversationId: event.conversationId } : {}) } : target;
  const openTarget: PetOpenTarget | undefined = event.type === 'completed' && eventTarget?.conversationId && event.messageId
    ? { kind: 'conversation', conversationId: eventTarget.conversationId, runId: eventTarget.runId, messageId: event.messageId }
    : event.type === 'failed' && eventTarget?.conversationId
      ? { kind: 'run', conversationId: eventTarget.conversationId, runId: eventTarget.runId }
      : event.type === 'approval_required' && eventTarget?.conversationId && event.approvalId
        ? { kind: 'approval', conversationId: eventTarget.conversationId, runId: eventTarget.runId, approvalId: event.approvalId }
        : undefined;
  let label = PET_STATE_LABELS[state];
  let detail: string | undefined;
  switch (event.type) {
    case 'accepted': label = '正在思考'; break;
    case 'delta': label = '正在生成回复'; break;
    case 'tool_start':
      label = '正在使用工具';
      detail = petToolDisplayName(event.toolName);
      break;
    case 'tool_end':
      label = event.isError ? '工具执行失败' : '正在整理结果';
      detail = petToolDisplayName(event.toolName);
      break;
    case 'approval_required':
      label = '等待你的确认';
      detail = petToolDisplayName(event.toolName);
      break;
    case 'approval_resolved': label = event.approved === true ? '继续执行' : '等待你的决定'; break;
    case 'completed': label = '任务完成'; break;
    case 'failed': label = '执行失败'; break;
    case 'cancelled': label = '已停止'; break;
    default: break;
  }
  return {
    state,
    label,
    ...(detail ? { detail } : {}),
    ...(eventTarget?.conversationId ? { conversationId: eventTarget.conversationId } : {}),
    ...(eventTarget?.runId ? { runId: eventTarget.runId } : {}),
    ...(event.toolName && !detail ? { toolName: petToolDisplayName(event.toolName) } : {}),
    ...(openTarget ? { openTarget } : {}),
  };
}

const PET_TOOL_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  bash: '正在运行命令',
  read: '正在读取文件',
  write: '正在写入文件',
  edit: '正在编辑文件',
  browser_navigate: '正在打开网页',
  browser_get_state: '正在读取网页',
  browser_screenshot: '正在截取网页',
  browser_click: '正在操作网页',
  browser_type: '正在填写网页',
  browser_scroll: '正在浏览网页',
  browser_go_back: '正在返回上一页',
  browser_list_tabs: '正在查看标签页',
  browser_switch_tab: '正在切换标签页',
  browser_close_tab: '正在关闭标签页',
  find_roots: '正在查找窗口',
  observe_ui: '正在查看屏幕',
  search_ui: '正在搜索界面',
  expand_ui: '正在展开界面',
  inspect_ui: '正在检查控件',
  act_ui: '正在操作界面',
  read_text: '正在读取界面文字',
  wait_for: '正在等待界面变化',
  launch_browser: '正在启动浏览器',
  navigate_browser: '正在打开网页',
  evaluate_browser: '正在执行网页操作',
  task_list: '正在查看任务',
  task_create: '正在创建任务',
  task_update: '正在更新任务',
};

export function petToolDisplayName(value: string | undefined): string | undefined {
  const safeName = safeToolName(value);
  return safeName ? PET_TOOL_DISPLAY_NAMES[safeName] ?? safeName : undefined;
}

function safeToolName(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return trimmed ? trimmed.slice(0, 64) : undefined;
}

function safeFeedbackText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}
