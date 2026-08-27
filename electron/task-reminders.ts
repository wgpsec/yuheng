import type { Task } from './store';

const MAX_TIMER_DELAY_MS = 2_147_000_000;

type TimerHandle = ReturnType<typeof setTimeout>;

export type TaskReminderSchedulerOptions = {
  listPending: () => Task[];
  claim: (taskId: string, expectedRemindAt: string) => Task | null;
  notify: (task: Task, onClick: () => void) => void;
  openTask: (boardId: string, taskId: string) => void;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (timer: TimerHandle) => void;
};

export class TaskReminderScheduler {
  private timer: TimerHandle | undefined;

  constructor(private readonly options: TaskReminderSchedulerOptions) {}

  refresh(): void {
    this.cancelTimer();
    const now = (this.options.now ?? Date.now)();
    const pending = this.options.listPending();
    for (const item of pending) {
      if (!item.remindAt || Date.parse(item.remindAt) > now) continue;
      const claimed = this.options.claim(item.id, item.remindAt);
      if (!claimed) continue;
      this.options.notify(claimed, () => this.options.openTask(claimed.boardId, claimed.id));
    }

    const next = this.options.listPending().find((item) => item.remindAt !== null && Number.isFinite(Date.parse(item.remindAt)));
    if (!next?.remindAt) return;
    const delay = Math.min(MAX_TIMER_DELAY_MS, Math.max(0, Date.parse(next.remindAt) - now));
    const schedule = this.options.setTimer ?? setTimeout;
    this.timer = schedule(() => {
      this.timer = undefined;
      this.refresh();
    }, delay);
  }

  dispose(): void {
    this.cancelTimer();
  }

  private cancelTimer(): void {
    if (this.timer === undefined) return;
    (this.options.clearTimer ?? clearTimeout)(this.timer);
    this.timer = undefined;
  }
}
