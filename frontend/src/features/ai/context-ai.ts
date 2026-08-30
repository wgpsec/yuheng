export type BoardAiTask = { title: string; status: string; priority: string; dueAt: string | null; description?: string };

const MAX_CONTEXT_CHARS = 12_000;

function bound(value: string, limit = MAX_CONTEXT_CHARS): string {
  return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 18))}\n…（上下文已截断）`;
}

export function buildNoteAiContext(note: { title: string; content: string }): string {
  return bound(`页面：${note.title}\n正文：\n${note.content || '（页面暂无正文）'}`);
}

export function buildBoardAiContext(boardName: string, tasks: readonly BoardAiTask[]): string {
  const lines = tasks.map((task) => `- ${task.title}｜状态：${task.status}｜优先级：${task.priority}｜截止：${task.dueAt || '无'}`);
  return bound(`看板：${boardName}\n任务：\n${lines.length ? lines.join('\n') : '（看板暂无任务）'}`);
}

export function buildContextAiPrompt(context: string, userPrompt: string): string {
  return `请仅基于以下上下文回答用户问题，不要编造未提供的事实，也不要修改页面或任务。\n\n${bound(context)}\n\n用户问题：\n${userPrompt.trim()}`;
}

export function buildContextAiTurnPrompt(history: readonly { role: 'user' | 'assistant'; content: string }[], prompt: string): string {
  const previous = history.slice(-6).map((message) => `${message.role === 'user' ? '用户' : '玉衡'}：${message.content}`).join('\n\n');
  return previous ? `此前对话（仅用于保持上下文）：\n${bound(previous, 6000)}\n\n当前问题：\n${prompt.trim()}` : prompt.trim();
}
