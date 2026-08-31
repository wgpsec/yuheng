import { externalHttpUrl } from '../external-links';
import type { DesktopPresenceConfig } from '../store';
import type { DomainIpcRegistrar } from './secured-ipc-registrar';

export type AppIpcDependencies = {
  registrar: DomainIpcRegistrar;
  applicationVersion: string;
  platform: string;
  arch: string;
  openExternal(url: string): Promise<unknown>;
  search(query: string, limit?: number): unknown;
  getDesktopPresence(): DesktopPresenceConfig;
  saveDesktopPresence(raw: unknown): DesktopPresenceConfig;
};

export function registerAppIpc(dependencies: AppIpcDependencies): void {
  const { registrar } = dependencies;
  registrar.main('app:get-info', () => ({
    name: 'yuheng',
    version: dependencies.applicationVersion,
    platform: dependencies.platform,
    arch: dependencies.arch,
  }));
  registrar.main('app:open-external', async (_event, rawUrl: unknown) => {
    const url = externalHttpUrl(rawUrl);
    if (!url) throw new Error('只允许打开 http 或 https 链接。');
    await dependencies.openExternal(url);
  });
  registrar.main('search:query', (_event, rawQuery: unknown, rawLimit: unknown) => {
    const query = typeof rawQuery === 'string' ? rawQuery : '';
    const limit = typeof rawLimit === 'number' && Number.isFinite(rawLimit) ? rawLimit : undefined;
    return dependencies.search(query, limit);
  });
  registrar.main('desktop-presence:get-config', () => dependencies.getDesktopPresence());
  registrar.main('desktop-presence:save-config', (_event, raw: unknown) => dependencies.saveDesktopPresence(raw));
}
