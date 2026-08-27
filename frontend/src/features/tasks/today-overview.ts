import type { Task } from '../../contracts/desktop-bridge';

export type TodayTaskKind = 'overdue' | 'due_today' | 'reminder_today';
export type TodayTask = { task: Task; kind: TodayTaskKind };

function localDateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateOnlyKey(value: string | null): string {
  if (!value) return '';
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : localDateKey(value);
}

function isClosed(status: string): boolean {
  return status === 'done' || status === 'archived' || status.endsWith(':done') || status.endsWith(':archived');
}

export function listTodayTasks(tasks: Task[], now = new Date()): TodayTask[] {
  const today = localDateKey(now);
  const result: TodayTask[] = [];
  for (const task of tasks) {
    if (isClosed(task.status)) continue;
    const due = dateOnlyKey(task.dueAt);
    const reminder = task.reminderFiredAt ? '' : dateOnlyKey(task.remindAt);
    const kind: TodayTaskKind | null = due && due < today ? 'overdue' : due === today ? 'due_today' : reminder === today ? 'reminder_today' : null;
    if (kind) result.push({ task, kind });
  }
  const kindRank: Record<TodayTaskKind, number> = { overdue: 0, due_today: 1, reminder_today: 2 };
  return result.sort((left, right) => {
    const rank = kindRank[left.kind] - kindRank[right.kind];
    if (rank !== 0) return rank;
    const leftDate = left.task.dueAt ?? left.task.remindAt ?? left.task.updatedAt;
    const rightDate = right.task.dueAt ?? right.task.remindAt ?? right.task.updatedAt;
    return leftDate.localeCompare(rightDate) || left.task.title.localeCompare(right.task.title, 'zh-CN');
  });
}

export function todayTaskKindLabel(kind: TodayTaskKind): string {
  return kind === 'overdue' ? '已逾期' : kind === 'due_today' ? '今天到期' : '今天提醒';
}
