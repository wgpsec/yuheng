export function taskDraftFromMessage(content: string): { title: string; description: string } {
  const normalized = content.replace(/\s+/g, ' ').trim();
  const title = Array.from(normalized || '未命名任务').slice(0, 80).join('');
  return { title, description: content.trim() };
}
