import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { buildBackupArchive, readBackupArchive } from './backup-archive';
import type { AppStore, FullBackupSnapshot } from './store';

const DATA_FILES: Array<[keyof FullBackupSnapshot, string]> = [
  ['conversationProjects', 'data/conversation-projects.json'], ['conversations', 'data/conversations.json'], ['messages', 'data/messages.json'],
  ['runs', 'data/runs.json'], ['runActivities', 'data/run-activities.json'], ['runArtifacts', 'data/run-artifacts.json'],
  ['providers', 'data/providers.json'], ['appSettings', 'data/app-settings.json'], ['taskBoards', 'data/task-boards.json'],
  ['taskTypes', 'data/task-types.json'], ['tasks', 'data/tasks.json'],
];

async function collectFiles(root: string, prefix: string, output: Record<string, Buffer>): Promise<void> {
  if (!fs.existsSync(root)) return;
  const walk = async (current: string) => {
    for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) output[`${prefix}/${path.relative(root, absolute).split(path.sep).join('/')}`] = await fsp.readFile(absolute);
    }
  };
  await walk(root);
}

export async function createFullBackup(options: { dataDir: string; store: AppStore; appVersion: string; platform: string }): Promise<Buffer> {
  const snapshot = options.store.exportFullBackupSnapshot();
  const files: Record<string, Buffer> = {};
  for (const [key, filename] of DATA_FILES) files[filename] = Buffer.from(JSON.stringify(snapshot[key]));
  await collectFiles(path.join(options.dataDir, 'task-assets'), 'files/task-assets', files);
  await collectFiles(path.join(options.dataDir, 'browser-use', 'screenshots'), 'files/run-artifacts', files);
  await collectFiles(path.join(options.dataDir, 'pi-agent', 'sessions'), 'sessions', files);
  return buildBackupArchive(files, {
    appVersion: options.appVersion,
    platform: options.platform,
    counts: { conversations: snapshot.conversations.length, messages: snapshot.messages.length, runs: snapshot.runs.length, tasks: snapshot.tasks.length },
  });
}

function parseDataset<T>(files: Map<string, Buffer>, filename: string, fallback: T): T {
  const value = files.get(filename);
  if (!value) return fallback;
  const parsed: unknown = JSON.parse(value.toString('utf8'));
  return parsed as T;
}

export async function restoreFullBackup(options: { dataDir: string; store: AppStore; archive: Uint8Array }): Promise<{ conversations: number; messages: number; tasks: number; missingProviders: number; contextUnavailable: boolean; conversationMap?: Record<string, string> }> {
  const parsed = readBackupArchive(options.archive);
  const empty = [] as never[];
  const snapshot = {
    conversationProjects: parseDataset(parsed.files, 'data/conversation-projects.json', empty), conversations: parseDataset(parsed.files, 'data/conversations.json', empty), messages: parseDataset(parsed.files, 'data/messages.json', empty), runs: parseDataset(parsed.files, 'data/runs.json', empty), runActivities: parseDataset(parsed.files, 'data/run-activities.json', empty), runArtifacts: parseDataset(parsed.files, 'data/run-artifacts.json', empty), providers: parseDataset(parsed.files, 'data/providers.json', empty), appSettings: parseDataset(parsed.files, 'data/app-settings.json', empty), taskBoards: parseDataset(parsed.files, 'data/task-boards.json', empty), taskTypes: parseDataset(parsed.files, 'data/task-types.json', empty), tasks: parseDataset(parsed.files, 'data/tasks.json', empty),
  } as FullBackupSnapshot;
  // Stage managed files first. A failure here occurs before any database write.
  let contextUnavailable = false;
  const copied: string[] = [];
  try {
  for (const [name, data] of parsed.files) {
    if (name.startsWith('sessions/')) continue;
    let destinationRoot: string | null = null;
    let relative = '';
    if (name.startsWith('files/task-assets/')) { destinationRoot = path.join(options.dataDir, 'task-assets'); relative = name.slice('files/task-assets/'.length); }
    else if (name.startsWith('files/run-artifacts/')) { destinationRoot = path.join(options.dataDir, 'browser-use', 'screenshots'); relative = name.slice('files/run-artifacts/'.length); }
    if (!destinationRoot) continue;
    await fsp.mkdir(destinationRoot, { recursive: true });
    const target = path.join(destinationRoot, `${crypto.randomUUID()}${path.extname(relative)}`);
    await fsp.writeFile(target, data, { flag: 'wx', mode: 0o600 });
    copied.push(target);
  }
  } catch (error) {
    await Promise.all(copied.map((file) => fsp.rm(file, { force: true })));
    throw error;
  }
  let result: ReturnType<AppStore['importFullBackupSnapshot']>;
  try { result = options.store.importFullBackupSnapshot(snapshot); }
  catch (error) { await Promise.all(copied.map((file) => fsp.rm(file, { force: true }))); throw error; }
  // Restore Pi sessions under the remapped conversation directory when present.
  for (const [name, data] of parsed.files) {
    if (!name.startsWith('sessions/')) continue;
    const parts = name.split('/');
    const mappedConversation = result.conversationMap[parts[1] ?? ''];
    if (!mappedConversation || parts.length < 3) { contextUnavailable = true; continue; }
    const target = path.join(options.dataDir, 'pi-agent', 'sessions', mappedConversation, ...parts.slice(2));
    await fsp.mkdir(path.dirname(target), { recursive: true });
    try { await fsp.writeFile(target, data, { flag: 'wx', mode: 0o600 }); } catch { contextUnavailable = true; }
  }
  return { ...result, contextUnavailable };
}
