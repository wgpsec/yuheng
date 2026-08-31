import { dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { BackupRunAdmission } from '../backup-run-admission';
import { createFullBackup, restoreFullBackup } from '../full-backup';
import type { SecretStore } from '../secrets';
import type { AppStore, BackupConfig } from '../store';
import type { DomainIpcRegistrar } from './secured-ipc-registrar';

export type BackupIpcDependencies = {
  registrar: DomainIpcRegistrar;
  store: AppStore;
  secrets: SecretStore;
  admission: BackupRunAdmission;
  dataDirectory: string;
  documentsDirectory: string;
  applicationVersion: string;
  platform: string;
  arch: string;
  defaultDirectory(): string;
  waitForIdle(timeoutMs: number): Promise<void>;
  hasActiveRuns(): boolean;
  runAutomaticBackup(): Promise<void>;
};

export function registerBackupIpc(dependencies: BackupIpcDependencies): void {
  const { registrar, store, secrets } = dependencies;
  registrar.main('backup:export', async () => dependencies.admission.run(async () => {
    await dependencies.waitForIdle(10 * 60 * 1000);
    if (dependencies.hasActiveRuns()) throw new Error('当前仍有运行中的任务，请稍后再试。');
    const target = await dialog.showSaveDialog({ defaultPath: path.join(dependencies.documentsDirectory, `yuheng-backup-${new Date().toISOString().slice(0, 10)}.yuheng`), filters: [{ name: '玉衡备份', extensions: ['yuheng'] }] });
    if (target.canceled || !target.filePath) return null;
    const archive = await createFullBackup({ dataDir: dependencies.dataDirectory, store, providerKeys: secrets.exportProviderKeys(), appVersion: dependencies.applicationVersion, platform: `${dependencies.platform}-${dependencies.arch}` });
    const temporaryPath = `${target.filePath}.tmp-${crypto.randomUUID()}`;
    try { await fs.writeFile(temporaryPath, archive, { flag: 'wx' }); await fs.rename(temporaryPath, target.filePath); return target.filePath; }
    catch (error) { await fs.rm(temporaryPath, { force: true }); throw error; }
  }));
  registrar.main('backup:import', async () => {
    const selected = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: '玉衡备份', extensions: ['yuheng'] }] });
    if (selected.canceled || !selected.filePaths[0]) return null;
    const report = await restoreFullBackup({ dataDir: dependencies.dataDirectory, store, archive: await fs.readFile(selected.filePaths[0]) });
    secrets.saveProviderKeys(report.providerKeys);
    const { conversationMap: _conversationMap, providerKeys: _providerKeys, ...publicReport } = report;
    return publicReport;
  });
  registrar.main('backup:get-config', (): BackupConfig => store.getBackupConfig(dependencies.defaultDirectory()));
  registrar.main('backup:save-config', (_event, raw: unknown): BackupConfig => {
    if (!raw || typeof raw !== 'object') throw new Error('无效的备份设置。');
    const input = raw as Record<string, unknown>;
    const directory = typeof input.directory === 'string' && input.directory.trim() ? input.directory.trim() : dependencies.defaultDirectory();
    const retention = typeof input.retention === 'number' && Number.isFinite(input.retention) ? input.retention : 7;
    const saved = store.saveBackupConfig({ enabled: input.enabled === true, directory, retention });
    if (saved.enabled) void dependencies.runAutomaticBackup();
    return saved;
  });
}
