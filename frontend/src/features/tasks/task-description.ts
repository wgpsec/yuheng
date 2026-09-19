export function normalizeTaskMarkdown(value: string): string {
  return value.replace(/&nbsp;/gi, '').replace(/\u00a0/g, ' ').trim();
}

export function taskDescriptionPreview(value: string): string {
  return normalizeTaskMarkdown(value)
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '').trim())
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .split(/\r?\n/)
    .map((line) => line
      .replace(/^\s{0,3}[-*+]\s+\[([ xX]?)\]\s*/, (_match, checked: string) => checked.trim() ? '☑ ' : '☐ ')
      // Accept the compact checklist syntax commonly pasted from task notes.
      .replace(/(^|\s)\[([ xX]?)\]\s*/g, (_match, prefix: string, checked: string) => `${prefix}${checked.trim() ? '☑' : '☐'} `)
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/^\s{0,3}[-*+]\s+/, '• ')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/[*_`~]/g, '')
      .trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}
