export type NoteTemplate = {
  id: 'blank' | 'meeting' | 'project' | 'reading' | 'weekly' | 'technical';
  name: string;
  description: string;
  icon: string | null;
  title: string;
  content: string;
};

export const NOTE_TEMPLATES: readonly NoteTemplate[] = [
  { id: 'blank', name: '空白页面', description: '从空白页面开始', icon: null, title: '未命名笔记', content: '' },
  { id: 'meeting', name: '会议记录', description: '议题、结论和后续行动', icon: '🗓️', title: '会议记录', content: '## 会议信息\n\n- 日期：\n- 参与人：\n\n## 议题\n\n\n## 结论\n\n\n## 后续行动\n\n- [ ] ' },
  { id: 'project', name: '项目计划', description: '目标、里程碑与风险', icon: '🎯', title: '项目计划', content: '## 项目目标\n\n\n## 里程碑\n\n- [ ] \n\n## 风险与依赖\n\n' },
  { id: 'reading', name: '读书笔记', description: '摘要、摘录和思考', icon: '📚', title: '读书笔记', content: '## 基本信息\n\n- 书名：\n- 作者：\n\n## 核心观点\n\n\n## 摘录\n\n> \n\n## 我的思考\n\n' },
  { id: 'weekly', name: '每周复盘', description: '进展、问题与下周重点', icon: '📅', title: '每周复盘', content: '## 本周完成\n\n- [ ] \n\n## 遇到的问题\n\n\n## 下周重点\n\n- [ ] ' },
  { id: 'technical', name: '技术文档', description: '背景、方案、验证与风险', icon: '🧩', title: '技术文档', content: '## 背景\n\n\n## 方案\n\n\n## 验证\n\n```\n\n```\n\n## 风险\n\n' },
];

export function getNoteTemplate(id: NoteTemplate['id']): NoteTemplate {
  return NOTE_TEMPLATES.find((template) => template.id === id) ?? NOTE_TEMPLATES[0];
}
