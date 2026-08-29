export function taskDraftFromNote(note: { title?: string; content?: string }): { title: string; description: string } {
  const title = typeof note.title === 'string' && note.title.trim() ? note.title.trim() : '未命名任务';
  return { title, description: typeof note.content === 'string' ? note.content : '' };
}
