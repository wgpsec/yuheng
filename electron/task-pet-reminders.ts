import type { Task } from './store';
import type { PetFeedback } from './pet-state';

const MAX_TASK_TITLE_CODE_POINTS = 26;

/** Keep reminder copy useful without exposing task body or arbitrary input. */
export function clipTaskReminderTitle(title: string): string {
  const normalized = title.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const points = [...normalized];
  return points.length > MAX_TASK_TITLE_CODE_POINTS
    ? `${points.slice(0, MAX_TASK_TITLE_CODE_POINTS).join('')}…`
    : points.join('');
}

export function taskReminderFeedback(task: Pick<Task, 'id' | 'boardId' | 'title'>): PetFeedback {
  return {
    state: 'attention',
    label: '任务提醒',
    kind: 'task_reminder',
    detail: clipTaskReminderTitle(task.title) || '有一项任务需要处理',
    openTarget: { kind: 'task', boardId: task.boardId, taskId: task.id },
  };
}

type QueuedReminder = { task: Task; sequence: number; expiresAt: number };

export type TaskPetReminderQueueOptions = { ttlMs?: number };

/** In-memory FIFO for Pet reminders; persistence and claiming remain in AppStore. */
export class TaskPetReminderQueue {
  private readonly ttlMs: number;
  private readonly entries = new Map<string, QueuedReminder>();
  private sequence = 0;

  constructor(options: TaskPetReminderQueueOptions = {}) {
    this.ttlMs = typeof options.ttlMs === 'number' && Number.isFinite(options.ttlMs) && options.ttlMs > 0 ? options.ttlMs : 12_000;
  }

  enqueue(task: Task, now = Date.now()): boolean {
    this.prune(now);
    const existing = this.entries.get(task.id);
    if (existing && existing.task.remindAt === task.remindAt) return false;
    this.entries.set(task.id, { task, sequence: this.sequence += 1, expiresAt: now + this.ttlMs });
    return true;
  }

  next(now = Date.now()): Task | undefined {
    this.prune(now);
    const ordered = [...this.entries.values()].sort((left, right) => {
      const leftDate = left.task.remindAt ? Date.parse(left.task.remindAt) : Number.POSITIVE_INFINITY;
      const rightDate = right.task.remindAt ? Date.parse(right.task.remindAt) : Number.POSITIVE_INFINITY;
      return (Number.isFinite(leftDate) ? leftDate : Number.POSITIVE_INFINITY) - (Number.isFinite(rightDate) ? rightDate : Number.POSITIVE_INFINITY)
        || left.task.id.localeCompare(right.task.id)
        || left.sequence - right.sequence;
    });
    const item = ordered[0];
    if (!item) return undefined;
    this.entries.delete(item.task.id);
    return item.task;
  }

  size(now = Date.now()): number {
    this.prune(now);
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  private prune(now: number): void {
    for (const [id, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(id);
  }
}
