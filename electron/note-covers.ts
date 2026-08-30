import fs from 'node:fs';
import path from 'node:path';

export const NOTE_COVER_SCHEME = 'yuheng-note-cover';
export const MAX_NOTE_COVER_BYTES = 15 * 1024 * 1024;

const imageExtensions: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};
const filePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:png|jpg|webp)$/i;

export type NoteCover = { id: string; mimeType: string; size: number; url: string };

export class NoteCoverStore {
  constructor(private readonly rootDir: string) {}

  import(name: string, mimeType: string, data: Uint8Array): NoteCover {
    const extension = imageExtensions[mimeType.trim().toLowerCase()];
    if (!extension) throw new Error('仅支持 PNG、JPEG 或 WebP 封面。');
    if (data.byteLength === 0) throw new Error('封面图片为空。');
    if (data.byteLength > MAX_NOTE_COVER_BYTES) throw new Error('封面图片不能超过 15 MB。');
    const id = crypto.randomUUID();
    const fileName = `${id}${extension}`;
    fs.mkdirSync(this.rootDir, { recursive: true });
    fs.writeFileSync(path.join(this.rootDir, fileName), data, { flag: 'wx', mode: 0o600 });
    return { id, mimeType: mimeType.trim().toLowerCase(), size: data.byteLength, url: `${NOTE_COVER_SCHEME}://local/${fileName}` };
  }

  resolveUrl(rawUrl: string): string {
    const url = new URL(rawUrl);
    const fileName = decodeURIComponent(url.pathname).replace(/^\//, '');
    if (url.protocol !== `${NOTE_COVER_SCHEME}:` || url.hostname !== 'local' || url.username || url.password || url.port || url.search || url.hash || !filePattern.test(fileName)) throw new Error('Invalid note cover URL.');
    return path.join(this.rootDir, fileName);
  }

  remove(rawUrl: string): void {
    try { fs.rmSync(this.resolveUrl(rawUrl), { force: true }); } catch { /* invalid or already removed */ }
  }
}
