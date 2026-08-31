export type SlashCommandId = 'paragraph' | 'heading1' | 'heading2' | 'bulletList' | 'orderedList' | 'taskList' | 'blockquote' | 'callout' | 'details' | 'horizontalRule' | 'table' | 'codeBlock' | 'attachment';
export type SlashCommandCategory = 'basic' | 'list' | 'content' | 'media';
export type SlashCommand = { id: SlashCommandId; label: string; hint: string; category: SlashCommandCategory; aliases: readonly string[] };
export type SlashCommandGroup = { id: 'recent' | SlashCommandCategory; label: string; commands: SlashCommand[] };

export const slashCommands: readonly SlashCommand[] = [
  { id: 'paragraph', label: '正文', hint: '普通文本块', category: 'basic', aliases: ['text', 'paragraph', '文本'] },
  { id: 'heading1', label: '一级标题', hint: '大标题', category: 'basic', aliases: ['h1', 'heading', '标题'] },
  { id: 'heading2', label: '二级标题', hint: '章节标题', category: 'basic', aliases: ['h2', 'heading', '标题'] },
  { id: 'bulletList', label: '项目列表', hint: '无序列表', category: 'list', aliases: ['bullet', 'ul', 'list'] },
  { id: 'orderedList', label: '编号列表', hint: '有序列表', category: 'list', aliases: ['number', 'ol', 'list'] },
  { id: 'taskList', label: '任务清单', hint: '可勾选列表', category: 'list', aliases: ['todo', 'task', 'checkbox'] },
  { id: 'blockquote', label: '引用', hint: '突出引用内容', category: 'content', aliases: ['quote', '引用'] },
  { id: 'callout', label: '提示块', hint: '突出信息或提醒', category: 'content', aliases: ['callout', 'info', '提示'] },
  { id: 'details', label: '折叠块', hint: '可展开的内容', category: 'content', aliases: ['details', 'toggle', '折叠'] },
  { id: 'horizontalRule', label: '分隔线', hint: '分隔上下内容', category: 'content', aliases: ['divider', 'rule', 'hr'] },
  { id: 'table', label: '表格', hint: '三列三行表格', category: 'content', aliases: ['table', 'grid'] },
  { id: 'codeBlock', label: '代码块', hint: '等宽代码内容', category: 'content', aliases: ['code', '代码'] },
  { id: 'attachment', label: '图片或附件', hint: '从本机选择文件', category: 'media', aliases: ['attachment', 'file', 'image', 'media', '附件', '图片'] },
];

const commandIds = new Set(slashCommands.map((command) => command.id));
const categoryLabels: Record<SlashCommandCategory, string> = { basic: '基础块', list: '列表', content: '内容块', media: '媒体' };

export function parseRecentSlashCommands(raw: string | null): SlashCommandId[] {
  try {
    const parsed = JSON.parse(raw ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((id): id is SlashCommandId => typeof id === 'string' && commandIds.has(id as SlashCommandId)))].slice(0, 6);
  } catch {
    return [];
  }
}

export function rememberSlashCommand(current: readonly SlashCommandId[], id: SlashCommandId): SlashCommandId[] {
  return [id, ...current.filter((value) => value !== id)].slice(0, 6);
}

export function slashCommandGroups(query: string, recent: readonly SlashCommandId[]): SlashCommandGroup[] {
  const normalized = query.trim().toLocaleLowerCase('zh-CN');
  const matches = slashCommands.filter((command) => !normalized || `${command.label} ${command.hint} ${command.id} ${command.aliases.join(' ')}`.toLocaleLowerCase('zh-CN').includes(normalized));
  const groups: SlashCommandGroup[] = [];
  const recentCommands = normalized ? [] : recent.map((id) => slashCommands.find((command) => command.id === id)).filter((command): command is SlashCommand => Boolean(command));
  if (recentCommands.length) groups.push({ id: 'recent', label: '最近使用', commands: recentCommands });
  const recentIds = new Set(recentCommands.map((command) => command.id));
  for (const category of ['basic', 'list', 'content', 'media'] as const) {
    const commands = matches.filter((command) => command.category === category && !recentIds.has(command.id));
    if (commands.length) groups.push({ id: category, label: categoryLabels[category], commands });
  }
  return groups;
}
