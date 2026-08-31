const NOTE_ID_PATTERN = '[A-Za-z0-9][A-Za-z0-9._~%-]{0,127}';
const NOTE_LINK_PATTERN = new RegExp(`\\[[^\\]\\n]*\\]\\(yuheng-note://(${NOTE_ID_PATTERN})\\)`, 'gu');

export function noteLinkHref(noteId: string): string {
  return `yuheng-note://${encodeURIComponent(noteId)}`;
}

export function noteLinkMarkdown(label: string, noteId: string): string {
  return `[${label.replaceAll(']', '\\]')}](${noteLinkHref(noteId)})`;
}

export function referencedNoteIds(markdown: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const match of markdown.matchAll(NOTE_LINK_PATTERN)) {
    let id: string;
    try { id = decodeURIComponent(match[1]); } catch { continue; }
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export function resolveNotePreview<T extends { id: string; archived: boolean }>(notes: readonly T[], noteId: string): T | null {
  return notes.find((note) => note.id === noteId && !note.archived) ?? null;
}
