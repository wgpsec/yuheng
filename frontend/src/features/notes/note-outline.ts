export type NoteOutlineItem = { index: number; level: 1 | 2 | 3; text: string };

export function noteOutline(markdown: string): NoteOutlineItem[] {
  const items: NoteOutlineItem[] = [];
  let fence: { marker: '`' | '~'; length: number } | null = null;
  for (const line of markdown.split(/\r?\n/u)) {
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/u);
    if (fenceMatch) {
      const marker = fenceMatch[1][0] as '`' | '~';
      if (!fence) fence = { marker, length: fenceMatch[1].length };
      else if (fence.marker === marker && fenceMatch[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const heading = line.match(/^\s{0,3}(#{1,3})\s+(.+?)\s*#*\s*$/u);
    if (!heading) continue;
    const text = heading[2].trim();
    if (text) items.push({ index: items.length, level: heading[1].length as 1 | 2 | 3, text });
  }
  return items;
}
