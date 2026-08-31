const TASK_MENTION_PREFIX = 'yuheng-task://';

export function taskMentionHref(boardId: string, taskId: string): string {
  return `${TASK_MENTION_PREFIX}${encodeURIComponent(boardId)}/${encodeURIComponent(taskId)}`;
}

export function parseTaskMentionHref(href: string): { boardId: string; taskId: string } | null {
  if (!href.startsWith(TASK_MENTION_PREFIX)) return null;
  const parts = href.slice(TASK_MENTION_PREFIX.length).split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const boardId = decodeURIComponent(parts[0]);
    const taskId = decodeURIComponent(parts[1]);
    return boardId && taskId ? { boardId, taskId } : null;
  } catch { return null; }
}

export function localDateMention(now: Date, offsetDays: number): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
