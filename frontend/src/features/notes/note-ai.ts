export type NoteAiAction = 'summarize' | 'rewrite' | 'expand' | 'extract_tasks' | 'custom';
export type NoteDiffLine = { kind: 'same' | 'added' | 'removed'; text: string };

export function diffNoteContent(original: string, generated: string): NoteDiffLine[] {
  const before = original.split('\n');
  const after = generated.split('\n');
  const table = Array.from({ length: before.length + 1 }, () => Array<number>(after.length + 1).fill(0));
  for (let row = before.length - 1; row >= 0; row -= 1) {
    for (let column = after.length - 1; column >= 0; column -= 1) {
      table[row][column] = before[row] === after[column] ? table[row + 1][column + 1] + 1 : Math.max(table[row + 1][column], table[row][column + 1]);
    }
  }
  const result: NoteDiffLine[] = [];
  let row = 0;
  let column = 0;
  while (row < before.length || column < after.length) {
    if (row < before.length && column < after.length && before[row] === after[column]) {
      result.push({ kind: 'same', text: before[row] }); row += 1; column += 1;
    } else if (row < before.length && (column === after.length || table[row + 1][column] >= table[row][column + 1])) {
      result.push({ kind: 'removed', text: before[row] }); row += 1;
    } else {
      result.push({ kind: 'added', text: after[column] }); column += 1;
    }
  }
  return result;
}

const actionInstructions: Record<Exclude<NoteAiAction, 'custom'>, string> = {
  summarize: '请总结这篇笔记，保留关键事实、决定和待办。',
  rewrite: '请改写这篇笔记，使表达更清晰、结构更易于阅读，但不要改变事实。',
  expand: '请基于这篇笔记补充必要背景、推导和下一步建议，不要编造事实。',
  extract_tasks: '请从这篇笔记中提取可执行的待办事项，输出标题、说明和建议截止时间。',
};

export function buildNoteAiPrompt(note: { title: string; content: string }, action: NoteAiAction, customInstruction?: string, selection?: string): string {
  const instruction = action === 'custom' ? customInstruction?.trim() || '请协助我整理这篇笔记。' : actionInstructions[action];
  const scope = selection?.trim() ? `以下是用户选中的片段，请只围绕该片段处理：\n${selection.trim()}` : `以下是整篇笔记，请仅基于这篇笔记处理，不要假设未提供的事实：\n${note.content || '（笔记暂无正文）'}`;
  return `${instruction}\n\n笔记标题：${note.title}\n\n${scope}`;
}

export function applyNoteAiResult(originalContent: string, action: NoteAiAction, generatedContent: string): { content: string; previousContent: string } {
  const generated = generatedContent.trim();
  if (!generated) return { content: originalContent, previousContent: originalContent };
  if (action === 'extract_tasks') return { content: originalContent.trim() ? `${originalContent.trim()}\n\n${generated}` : generated, previousContent: originalContent };
  return { content: generated, previousContent: originalContent };
}
