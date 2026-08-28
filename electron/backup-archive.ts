import { createHash } from 'node:crypto';
import { strToU8, unzipSync, zipSync } from 'fflate';

export const BACKUP_FORMAT = 'yuheng-backup' as const;
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 512 * 1024 * 1024;
export const MAX_ENTRY_BYTES = 100 * 1024 * 1024;
export const MAX_ENTRY_COUNT = 10_000;
export const MAX_UNCOMPRESSED_BYTES = 1_024 * 1024 * 1024;

export type BackupManifestEntry = { path: string; size: number; sha256: string; type: 'file' };
export type BackupManifest = {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  appVersion: string;
  platform: string;
  entries: BackupManifestEntry[];
  counts: Record<string, number>;
};

const SAFE_PATH = /^(?:data|files|sessions)\/[A-Za-z0-9._/-]+$/;

export function validateBackupPath(value: string): void {
  if (!value || value.startsWith('/') || value.includes('\\') || value.split('/').some((part) => part === '..' || part === '')) {
    throw new Error(`Invalid backup path: ${value}`);
  }
  if (!SAFE_PATH.test(value) || value.endsWith('/')) throw new Error(`Invalid backup path: ${value}`);
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function buildBackupArchive(
  input: Record<string, Uint8Array>,
  metadata: { appVersion?: string; platform?: string; counts?: Record<string, number> } = {},
): Buffer {
  const entries: BackupManifestEntry[] = [];
  const files: Record<string, Uint8Array> = {};
  let total = 0;
  for (const [name, raw] of Object.entries(input)) {
    validateBackupPath(name);
    const data = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    if (data.byteLength > MAX_ENTRY_BYTES) throw new Error(`Backup entry too large: ${name}`);
    total += data.byteLength;
    if (total > MAX_UNCOMPRESSED_BYTES) throw new Error('Backup is too large.');
    files[name] = data;
    entries.push({ path: name, size: data.byteLength, sha256: sha256(data), type: 'file' });
  }
  if (entries.length > MAX_ENTRY_COUNT) throw new Error('Too many backup entries.');
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: metadata.appVersion ?? 'unknown',
    platform: metadata.platform ?? process.platform,
    entries: entries.sort((a, b) => a.path.localeCompare(b.path)),
    counts: metadata.counts ?? {},
  };
  files['manifest.json'] = strToU8(JSON.stringify(manifest));
  const archive = Buffer.from(zipSync(files, { level: 6 }));
  if (archive.byteLength > MAX_BACKUP_BYTES) throw new Error('Backup archive is too large.');
  return archive;
}

export function readBackupArchive(archive: Uint8Array): { manifest: BackupManifest; files: Map<string, Buffer> } {
  if (archive.byteLength > MAX_BACKUP_BYTES) throw new Error('Backup archive is too large.');
  let unzipped: Record<string, Uint8Array>;
  try { unzipped = unzipSync(archive); } catch { throw new Error('Invalid or corrupt backup archive.'); }
  const names = Object.keys(unzipped);
  if (names.length > MAX_ENTRY_COUNT + 1 || !unzipped['manifest.json']) throw new Error('Backup manifest is missing.');
  let manifest: BackupManifest;
  try { manifest = JSON.parse(Buffer.from(unzipped['manifest.json']).toString('utf8')) as BackupManifest; } catch { throw new Error('Invalid backup manifest.'); }
  if (manifest.format !== BACKUP_FORMAT || manifest.version !== BACKUP_VERSION || !Array.isArray(manifest.entries)) throw new Error('Unsupported backup manifest.');
  const files = new Map<string, Buffer>();
  let total = 0;
  const listed = new Set<string>();
  for (const entry of manifest.entries) {
    if (!entry || entry.type !== 'file' || typeof entry.path !== 'string') throw new Error('Invalid backup entry.');
    validateBackupPath(entry.path);
    if (listed.has(entry.path)) throw new Error('Duplicate backup path.');
    listed.add(entry.path);
    const data = unzipped[entry.path];
    if (!data || data.byteLength !== entry.size || !/^[a-f0-9]{64}$/i.test(entry.sha256) || sha256(data) !== entry.sha256) throw new Error(`Backup hash mismatch: ${entry.path}`);
    if (data.byteLength > MAX_ENTRY_BYTES || (total += data.byteLength) > MAX_UNCOMPRESSED_BYTES) throw new Error('Backup contents are too large.');
    files.set(entry.path, Buffer.from(data));
  }
  for (const name of names) {
    if (name === 'manifest.json') continue;
    validateBackupPath(name);
    if (!listed.has(name)) throw new Error(`Unlisted backup entry: ${name}`);
  }
  return { manifest, files };
}
