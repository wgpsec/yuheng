import fs from 'node:fs/promises';
import path from 'node:path';

export const TASK_ASSET_SCHEME = 'yuheng-task-asset';
export const MAX_TASK_ASSET_BYTES = 10 * 1024 * 1024;

export type TaskAsset = { id: string; name: string; mimeType: string; size: number; url: string };

function safeExtension(name: string): string {
  const extension = path.extname(name).toLowerCase();
  return /^\.[a-z0-9]{1,12}$/.test(extension) ? extension : '';
}

export class TaskAssetStore {
  constructor(private readonly rootDir: string) {}

  async import(name: string, mimeType: string, data: Uint8Array): Promise<TaskAsset> {
    const displayName = path.basename(name.trim() || '附件');
    if (data.byteLength === 0) throw new Error('附件内容为空。');
    if (data.byteLength > MAX_TASK_ASSET_BYTES) throw new Error(`附件超过 10 MB：${displayName}`);
    const id = crypto.randomUUID();
    const fileName = `${id}${safeExtension(displayName)}`;
    await fs.mkdir(this.rootDir, { recursive: true });
    await fs.writeFile(path.join(this.rootDir, fileName), data, { flag: 'wx' });
    return {
      id,
      name: displayName,
      mimeType: mimeType.trim() || 'application/octet-stream',
      size: data.byteLength,
      url: `${TASK_ASSET_SCHEME}://local/${fileName}`,
    };
  }

  resolveUrl(rawUrl: string): string {
    const url = new URL(rawUrl);
    const fileName = decodeURIComponent(url.pathname).replace(/^\//, '');
    if (url.protocol !== `${TASK_ASSET_SCHEME}:` || url.hostname !== 'local' || !/^[0-9a-f-]{36}(?:\.[a-z0-9]{1,12})?$/i.test(fileName)) {
      throw new Error('Invalid task asset URL.');
    }
    return path.join(this.rootDir, fileName);
  }
}
