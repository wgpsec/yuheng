export function assertText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

export function assertNoteCover(value: unknown): string {
  const cover = assertText(value, 'cover');
  if (/^[a-z][a-z0-9-]{0,40}$/.test(cover) || /^yuheng-note-cover:\/\/local\/[0-9a-f-]{36}\.(?:png|jpg|webp)$/i.test(cover)) return cover;
  throw new Error('Invalid note cover.');
}
