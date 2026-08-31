import fs from 'node:fs/promises';
import path from 'node:path';
import { PET_STATES, type PetState } from './pet-state';

export type CodexPetAnimation = { row: number; durations: number[] };
export type CodexPetAnimations = Partial<Record<PetState, CodexPetAnimation>>;

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
  animations?: CodexPetAnimations;
};

export type CodexPetValidationIssue = {
  code: 'dimensions' | 'blank_frames' | 'frame_rate' | 'missing_states' | 'manifest';
  severity: 'error' | 'warning';
  message: string;
};

export type CodexPetStateReport = {
  state: PetState;
  row: number;
  frameCount: number;
  frameDurationMs: number;
  source: 'manifest' | 'default';
  fallback: boolean;
};

export type CodexPetCompatibilityReport = {
  status: 'compatible' | 'warning' | 'invalid';
  expected: { width: number; height: number };
  actual: { width: number; height: number };
  states: CodexPetStateReport[];
  issues: CodexPetValidationIssue[];
};

export type CodexPetValidationOptions = {
  width?: number;
  height?: number;
  blankFrameIndices?: number[];
};

export type CodexPetCatalogEntry = {
  id: string;
  displayName: string;
  description?: string;
  source: CodexPetManifest['source'];
  manifest?: CodexPetManifest;
  report: CodexPetCompatibilityReport;
};

/**
 * A package can remain selectable when only optional animation metadata is
 * malformed: parseAnimations() has already discarded those overrides and the
 * renderer will use the built-in state animation safely. Structural resource
 * failures must still stay out of the runtime.
 */
export function isCodexPetRuntimeUsable(entry: CodexPetCatalogEntry): boolean {
  return Boolean(
    entry.manifest
      && !entry.report.issues.some((item) => item.severity === 'error' && (
        item.code === 'dimensions'
        || item.code === 'blank_frames'
        || item.code === 'manifest'
      )),
  );
}

const MAX_SPRITESHEET_BYTES = 24 * 1024 * 1024;
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,96}$/;

const DEFAULT_PET_ANIMATIONS: Record<PetState, { row: number; durations: number[] }> = {
  idle: { row: 0, durations: [280, 110, 110, 140, 140, 320] },
  thinking: { row: 6, durations: [180, 130, 130, 180, 240] },
  working: { row: 7, durations: [120, 120, 120, 120, 120, 220] },
  attention: { row: 4, durations: [160, 160, 240, 240] },
  error: { row: 5, durations: [180, 180, 180, 300] },
  celebrate: { row: 3, durations: [140, 140, 140, 280] },
};

function issue(code: CodexPetValidationIssue['code'], severity: CodexPetValidationIssue['severity'], message: string): CodexPetValidationIssue {
  return { code, severity, message };
}

export function validateCodexPetManifest(manifest: CodexPetManifest, options: CodexPetValidationOptions = {}): CodexPetCompatibilityReport {
  const expected = { width: manifest.columns * manifest.cellWidth, height: manifest.rows * manifest.cellHeight };
  const actual = { width: options.width ?? expected.width, height: options.height ?? expected.height };
  const issues: CodexPetValidationIssue[] = [];
  if (options.width !== undefined || options.height !== undefined) {
    if (actual.width !== expected.width || actual.height !== expected.height) {
      issues.push(issue('dimensions', 'error', `精灵表尺寸为 ${actual.width}×${actual.height}，应为 ${expected.width}×${expected.height}。请调整画布或 manifest。`));
    }
  }
  const blankFrames = [...new Set((options.blankFrameIndices ?? []).filter((index) => Number.isInteger(index) && index >= 0))].sort((a, b) => a - b);
  if (blankFrames.length > 0) issues.push(issue('blank_frames', 'error', `发现 ${blankFrames.length} 个空白帧（${blankFrames.slice(0, 5).join('、')}${blankFrames.length > 5 ? '…' : ''}）。请补齐精灵内容。`));

  const states: CodexPetStateReport[] = [];
  const missingStates: PetState[] = [];
  for (const state of PET_STATES) {
    const animation = manifest.animations?.[state];
    const fallback = !animation;
    const selected = animation ?? DEFAULT_PET_ANIMATIONS[state];
    states.push({ state, row: selected.row, frameCount: selected.durations.length, frameDurationMs: Math.round(selected.durations.reduce((sum, value) => sum + value, 0) / selected.durations.length), source: fallback ? 'default' : 'manifest', fallback });
    if (fallback) missingStates.push(state);
    if (animation && (animation.row < 0 || animation.row >= manifest.rows || animation.durations.length < 1 || animation.durations.some((duration) => !Number.isFinite(duration) || duration < 16 || duration > 5_000))) {
      issues.push(issue('frame_rate', 'error', `${state} 状态的行号或帧时长无效，已回退到默认动画。`));
    }
  }
  if (missingStates.length > 0) issues.push(issue('missing_states', 'warning', `未提供 ${missingStates.join('、')} 状态，运行时将使用玉衡默认动画。`));
  const status = issues.some((item) => item.severity === 'error') ? 'invalid' : issues.length > 0 ? 'warning' : 'compatible';
  return { status, expected, actual, states, issues };
}

/** Reads dimensions from the lossless VP8X/VP8L WebP headers without decoding pixels. */
export function webpDimensions(buffer: Uint8Array): { width: number; height: number } | null {
  if (buffer.byteLength < 16 || String.fromCharCode(...buffer.slice(0, 4)) !== 'RIFF' || String.fromCharCode(...buffer.slice(8, 12)) !== 'WEBP') return null;
  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const type = String.fromCharCode(...buffer.slice(offset, offset + 4));
    const size = buffer[offset + 4] | (buffer[offset + 5] << 8) | (buffer[offset + 6] << 16) | (buffer[offset + 7] << 24);
    const payload = offset + 8;
    if (size < 0 || payload + size > buffer.byteLength) return null;
    if (type === 'VP8X' && size >= 10) {
      const width = 1 + buffer[payload + 4] + (buffer[payload + 5] << 8) + (buffer[payload + 6] << 16);
      const height = 1 + buffer[payload + 7] + (buffer[payload + 8] << 8) + (buffer[payload + 9] << 16);
      return { width, height };
    }
    if (type === 'VP8L' && size >= 5 && buffer[payload] === 0x2f) {
      const bits = buffer.slice(payload + 1, payload + 5);
      const width = 1 + (bits[0] | ((bits[1] & 0x3f) << 8));
      const height = 1 + ((bits[1] >> 6) | (bits[2] << 2) | ((bits[3] & 0xf) << 10));
      return { width, height };
    }
    offset = payload + size + (size % 2);
  }
  return null;
}

function invalidCatalogReport(message: string): CodexPetCompatibilityReport {
  return {
    status: 'invalid',
    expected: { width: 0, height: 0 },
    actual: { width: 0, height: 0 },
    states: [],
    issues: [issue('manifest', 'error', message)],
  };
}

function parseAnimations(value: unknown, rows: number): CodexPetAnimations | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const parsed: CodexPetAnimations = {};
  for (const state of PET_STATES) {
    const candidate = raw[state];
    if (!candidate || typeof candidate !== 'object') continue;
    const item = candidate as Record<string, unknown>;
    const row = item.row;
    const durations = item.durations;
    if (!Number.isInteger(row) || Number(row) < 0 || Number(row) >= rows || !Array.isArray(durations) || durations.length < 1 || durations.length > 64) continue;
    const normalizedDurations = durations.filter((duration): duration is number => typeof duration === 'number' && Number.isFinite(duration) && duration >= 16 && duration <= 5_000);
    if (normalizedDurations.length !== durations.length) continue;
    parsed[state] = { row: Number(row), durations: normalizedDurations };
  }
  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function invalidAnimationStates(value: unknown, rows: number): PetState[] {
  if (!value || typeof value !== 'object') return [];
  const raw = value as Record<string, unknown>;
  return PET_STATES.filter((state) => {
    const candidate = raw[state];
    if (!candidate || typeof candidate !== 'object') return false;
    const item = candidate as Record<string, unknown>;
    const durations = item.durations;
    return !Number.isInteger(item.row) || Number(item.row) < 0 || Number(item.row) >= rows || !Array.isArray(durations) || durations.length < 1 || durations.length > 64 || durations.some((duration) => typeof duration !== 'number' || !Number.isFinite(duration) || duration < 16 || duration > 5_000);
  });
}

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
  const rows = spriteVersionNumber === 2 ? 11 : 9;
  const animations = parseAnimations(raw.animations, rows);
  return {
    id,
    displayName,
    description: typeof raw.description === 'string' ? raw.description.trim() : undefined,
    spritesheetPath,
    spriteVersionNumber,
    rootPath,
    source,
    columns: 8,
    rows,
    cellWidth: 192,
    cellHeight: 208,
    ...(animations ? { animations } : {}),
  };
}

export async function inspectCodexPets(roots: Array<{ path: string; source: CodexPetManifest['source'] }>): Promise<CodexPetCatalogEntry[]> {
  const found = new Map<string, CodexPetCatalogEntry>();
  for (const root of roots) {
    let entries;
    try { entries = await fs.readdir(root.path, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const petRoot = path.join(root.path, entry.name);
      const fallbackId = ID_PATTERN.test(entry.name) ? entry.name : `invalid-${Buffer.from(entry.name).toString('hex').slice(0, 24)}`;
      try {
        const raw = JSON.parse(await fs.readFile(path.join(petRoot, 'pet.json'), 'utf8')) as unknown;
        const manifest = manifestFrom(raw, petRoot, root.source);
        const rawManifest = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
        const catalogId = manifest?.id ?? fallbackId;
        if (found.has(catalogId)) continue;
        if (!manifest) {
          found.set(catalogId, {
            id: catalogId,
            displayName: typeof rawManifest.displayName === 'string' && rawManifest.displayName.trim() ? rawManifest.displayName.trim() : entry.name,
            source: root.source,
            report: invalidCatalogReport('pet.json 缺少有效的 id、displayName 或安全的 WebP 资源路径。'),
          });
          continue;
        }
        const stat = await fs.lstat(path.resolve(petRoot, manifest.spritesheetPath));
        if (stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0 || stat.size > MAX_SPRITESHEET_BYTES) {
          found.set(manifest.id, { id: manifest.id, displayName: manifest.displayName, description: manifest.description, source: root.source, report: invalidCatalogReport('精灵表不存在、为空或超过 24 MB。') });
          continue;
        }
        const buffer = await fs.readFile(path.resolve(petRoot, manifest.spritesheetPath));
        const dimensions = webpDimensions(buffer);
        const report = validateCodexPetManifest(manifest, dimensions ?? {});
        const invalidStates = invalidAnimationStates(rawManifest.animations, manifest.rows);
        if (invalidStates.length > 0) {
          report.issues.push(issue('frame_rate', 'error', `${invalidStates.join('、')} 状态的行号或帧时长无效，运行时将回退到默认动画。`));
          report.status = 'invalid';
        }
        if (!dimensions) report.issues.push(issue('manifest', 'warning', '无法从 WebP 头读取画布尺寸；选择时将再次校验资源。'));
        if (!dimensions && report.status === 'compatible') report.status = 'warning';
        found.set(manifest.id, { id: manifest.id, displayName: manifest.displayName, description: manifest.description, source: root.source, manifest, report });
      } catch {
        if (!found.has(fallbackId)) found.set(fallbackId, { id: fallbackId, displayName: entry.name, source: root.source, report: invalidCatalogReport('皮肤包不完整，或 pet.json 不是有效的 JSON。') });
      }
    }
  }
  return [...found.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-CN'));
}

export async function scanCodexPets(roots: Array<{ path: string; source: CodexPetManifest['source'] }>): Promise<CodexPetManifest[]> {
  const catalog = await inspectCodexPets(roots);
  return catalog.flatMap((entry) => isCodexPetRuntimeUsable(entry) ? [entry.manifest!] : []);
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export async function importCodexPetPackage(packageRoot: string, targetRoot: string): Promise<CodexPetManifest> {
  const sourceRoot = path.resolve(packageRoot);
  const catalog = await inspectCodexPets([{ path: path.dirname(sourceRoot), source: 'yuheng' }]);
  const entry = catalog.find((item) => item.manifest?.rootPath && path.resolve(item.manifest.rootPath) === sourceRoot);
  if (!entry?.manifest || entry.report.status === 'invalid') throw new Error('皮肤包校验失败，请检查 pet.json 和 spritesheet.webp。');
  const destinationRoot = path.resolve(targetRoot);
  const destination = path.join(destinationRoot, entry.manifest.id);
  if (!isInside(destinationRoot, destination)) throw new Error('皮肤导入目录无效。');
  try { await fs.access(destination); throw new Error('同名皮肤已经存在，请先删除旧版本。'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await fs.mkdir(destinationRoot, { recursive: true });
  try {
    await fs.mkdir(destination, { recursive: true });
    const manifestStat = await fs.lstat(path.join(sourceRoot, 'pet.json'));
    const assetSource = path.resolve(sourceRoot, entry.manifest.spritesheetPath);
    const assetStat = await fs.lstat(assetSource);
    if (manifestStat.isSymbolicLink() || assetStat.isSymbolicLink()) throw new Error('皮肤包不能包含符号链接。');
    await fs.copyFile(path.join(sourceRoot, 'pet.json'), path.join(destination, 'pet.json'));
    const assetRelative = path.relative(sourceRoot, assetSource);
    if (!assetRelative || assetRelative.startsWith('..') || path.isAbsolute(assetRelative)) throw new Error('皮肤资源路径无效。');
    const assetDestination = path.join(destination, assetRelative);
    await fs.mkdir(path.dirname(assetDestination), { recursive: true });
    await fs.copyFile(assetSource, assetDestination);
  } catch (error) {
    await fs.rm(destination, { recursive: true, force: true });
    throw error;
  }
  const imported = (await scanCodexPets([{ path: destinationRoot, source: 'yuheng' }])).find((item) => item.id === entry.manifest!.id);
  if (!imported) {
    await fs.rm(destination, { recursive: true, force: true });
    throw new Error('导入后的皮肤校验失败。');
  }
  return imported;
}

export async function deleteCodexPetPackage(petId: string, roots: Array<string>, activePetId?: string): Promise<void> {
  const id = petId.trim();
  if (!ID_PATTERN.test(id)) throw new Error('皮肤标识无效。');
  if (activePetId === id) throw new Error('当前皮肤正在使用，请先切换到默认皮肤后再删除。');
  const manifests = await scanCodexPets(roots.map((root) => ({ path: root, source: 'yuheng' as const })));
  const manifest = manifests.find((item) => item.id === id);
  if (!manifest) throw new Error('找不到要删除的皮肤。');
  const packageRoot = path.resolve(manifest.rootPath);
  if (!roots.some((root) => isInside(root, packageRoot))) throw new Error('皮肤目录不在受管理的位置。');
  await fs.rm(packageRoot, { recursive: true, force: true });
}

export async function readCodexPetAsset(manifest: CodexPetManifest): Promise<Buffer> {
  const root = path.resolve(manifest.rootPath);
  const assetPath = path.resolve(root, manifest.spritesheetPath);
  const relative = path.relative(root, assetPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.extname(assetPath).toLowerCase() !== '.webp') {
    throw new Error('宠物资源路径无效。');
  }
  const stat = await fs.lstat(assetPath);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0 || stat.size > MAX_SPRITESHEET_BYTES) throw new Error('宠物精灵表大小无效。');
  return fs.readFile(assetPath);
}

export const CODEX_PET_MAX_BYTES = MAX_SPRITESHEET_BYTES;
