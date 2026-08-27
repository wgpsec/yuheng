import type { Task } from '../../contracts/desktop-bridge';

export type TaskFilter = 'all' | 'open' | 'due' | 'reminder';

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isClosed(status: string): boolean {
  return status === 'done' || status === 'archived' || status.endsWith(':done') || status.endsWith(':archived');
}

function dueOnOrBeforeToday(task: Task, today: string): boolean {
  return Boolean(task.dueAt && task.dueAt.slice(0, 10) <= today);
}

export function filterBoardTasks(tasks: Task[], query: string, filter: TaskFilter, now = new Date()): Task[] {
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
  const today = localDateKey(now);
  return tasks.filter((task) => {
    const matchesQuery = !normalizedQuery || `${task.title}\n${task.description}`.toLocaleLowerCase('zh-CN').includes(normalizedQuery);
    if (!matchesQuery) return false;
    if (filter === 'open') return !isClosed(task.status);
    if (filter === 'due') return !isClosed(task.status) && dueOnOrBeforeToday(task, today);
    if (filter === 'reminder') return !isClosed(task.status) && Boolean(task.remindAt && !task.reminderFiredAt);
    return true;
  });
}
