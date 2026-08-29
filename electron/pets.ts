import fs from 'node:fs/promises';
import path from 'node:path';

export type CodexPetManifest = {
  id: string;
  displayName: string;
  description?: string;
  spritesheetPath: string;
  spriteVersionNumber?: number;
  rootPath: string;
  source: 'codex' | 'yuheng';
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
};

const MAX_SPRITESHEET_BYTES = 24 * 1024 * 1024;
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,96}$/;

function manifestFrom(value: unknown, rootPath: string, source: CodexPetManifest['source']): CodexPetManifest | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const displayName = typeof raw.displayName === 'string' ? raw.displayName.trim() : '';
  const spritesheetPath = typeof raw.spritesheetPath === 'string' ? raw.spritesheetPath.trim() : '';
  if (!ID_PATTERN.test(id) || !displayName || !spritesheetPath || path.isAbsolute(spritesheetPath)) return null;
  const resolved = path.resolve(rootPath, spritesheetPath);
  const relative = path.relative(rootPath, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.extname(resolved).toLowerCase() !== '.webp') return null;
  const spriteVersionNumber = raw.spriteVersionNumber === 2 ? 2 : 1;
  return {
    id,
    displayName,
    description: typeof raw.description === 'string' ? raw.description.trim() : undefined,
    spritesheetPath,
    spriteVersionNumber,
    rootPath,
    source,
    columns: 8,
    rows: spriteVersionNumber === 2 ? 11 : 9,
    cellWidth: 192,
    cellHeight: 208,
  };
}

export async function scanCodexPets(roots: Array<{ path: string; source: CodexPetManifest['source'] }>): Promise<CodexPetManifest[]> {
  const found = new Map<string, CodexPetManifest>();
  for (const root of roots) {
    let entries;
    try { entries = await fs.readdir(root.path, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const petRoot = path.join(root.path, entry.name);
      try {
        const raw = JSON.parse(await fs.readFile(path.join(petRoot, 'pet.json'), 'utf8')) as unknown;
        const manifest = manifestFrom(raw, petRoot, root.source);
        if (!manifest || found.has(manifest.id)) continue;
        const stat = await fs.stat(path.resolve(petRoot, manifest.spritesheetPath));
        if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_SPRITESHEET_BYTES) continue;
        found.set(manifest.id, manifest);
      } catch { /* Ignore incomplete or malformed community packages. */ }
    }
  }
  return [...found.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-CN'));
}

export async function readCodexPetAsset(manifest: CodexPetManifest): Promise<Buffer> {
  const root = path.resolve(manifest.rootPath);
  const assetPath = path.resolve(root, manifest.spritesheetPath);
  const relative = path.relative(root, assetPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.extname(assetPath).toLowerCase() !== '.webp') {
    throw new Error('宠物资源路径无效。');
  }
  const stat = await fs.stat(assetPath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_SPRITESHEET_BYTES) throw new Error('宠物精灵表大小无效。');
  return fs.readFile(assetPath);
}

export const CODEX_PET_MAX_BYTES = MAX_SPRITESHEET_BYTES;
