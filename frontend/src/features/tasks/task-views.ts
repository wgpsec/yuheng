import type { Task } from '../../contracts/desktop-bridge';

export type TaskView = 'board' | 'list' | 'calendar';

export type CalendarDay = {
  date: Date;
  key: string;
  inMonth: boolean;
};

export function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Returns a Sunday-first six-week grid so the calendar never changes height. */
export function calendarDays(month: Date): CalendarDay[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { date, key: dateKey(date), inMonth: date.getMonth() === month.getMonth() };
  });
}

export function tasksByDueDate(tasks: Task[]): Map<string, Task[]> {
  const grouped = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.dueAt) continue;
    const key = task.dueAt.slice(0, 10);
    const items = grouped.get(key) ?? [];
    items.push(task);
    grouped.set(key, items);
  }
  return grouped;
}
