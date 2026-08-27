import fs from 'node:fs';
import path from 'node:path';

export const BROWSER_ARTIFACT_SCHEME = 'yuheng-browser-artifact';
export const MAX_BROWSER_ARTIFACT_BYTES = 15 * 1024 * 1024;

export type BrowserArtifact = {
  id: string;
  kind: 'browser_screenshot' | 'computer_screenshot';
  mimeType: string;
  size: number;
  url: string;
};

const imageExtensions: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};
const artifactFilePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:png|jpg|webp)$/i;

export class BrowserArtifactStore {
  constructor(private readonly rootDir: string) {}

  saveImage(base64: string, mimeType: string, kind: BrowserArtifact['kind'] = 'browser_screenshot'): BrowserArtifact {
    const extension = imageExtensions[mimeType];
    if (!extension) throw new Error(`Unsupported image artifact type: ${mimeType}`);
    const data = Buffer.from(base64, 'base64');
    if (data.byteLength === 0) throw new Error('Image artifact is empty.');
    if (data.byteLength > MAX_BROWSER_ARTIFACT_BYTES) throw new Error('Image artifact exceeds 15 MB.');
    const id = crypto.randomUUID();
    const fileName = `${id}${extension}`;
    fs.mkdirSync(this.rootDir, { recursive: true });
    fs.writeFileSync(path.join(this.rootDir, fileName), data, { flag: 'wx', mode: 0o600 });
    return {
      id,
      kind,
      mimeType,
      size: data.byteLength,
      url: `${BROWSER_ARTIFACT_SCHEME}://local/${fileName}`,
    };
  }

  resolveUrl(rawUrl: string): string {
    const url = new URL(rawUrl);
    const fileName = decodeURIComponent(url.pathname).replace(/^\//, '');
    if (url.protocol !== `${BROWSER_ARTIFACT_SCHEME}:`
      || url.hostname !== 'local'
      || url.username
      || url.password
      || url.port
      || url.search
      || url.hash
      || !artifactFilePattern.test(fileName)) {
      throw new Error('Invalid browser artifact URL.');
    }
    return path.join(this.rootDir, fileName);
  }

  deleteFilesBefore(cutoff: Date): number {
    if (!fs.existsSync(this.rootDir)) return 0;
    let deleted = 0;
    for (const entry of fs.readdirSync(this.rootDir, { withFileTypes: true })) {
      if (!entry.isFile() || !artifactFilePattern.test(entry.name)) continue;
      const filePath = path.join(this.rootDir, entry.name);
      if (fs.statSync(filePath).mtimeMs >= cutoff.getTime()) continue;
      fs.rmSync(filePath, { force: true });
      deleted += 1;
    }
    return deleted;
  }

  remove(rawUrl: string): void {
    try {
      fs.rmSync(this.resolveUrl(rawUrl), { force: true });
    } catch {
      // Cleanup is best effort; URL validation still prevents deleting outside the managed root.
    }
  }
}

export const imagesFromToolResult = browserImagesFromToolResult;

export function browserImagesFromToolResult(value: unknown): Array<{ data: string; mimeType: string }> {
  if (!value || typeof value !== 'object') return [];
  const content = (value as Record<string, unknown>).content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const block = item as Record<string, unknown>;
    return block.type === 'image' && typeof block.data === 'string' && typeof block.mimeType === 'string'
      ? [{ data: block.data, mimeType: block.mimeType }]
      : [];
  });
}
