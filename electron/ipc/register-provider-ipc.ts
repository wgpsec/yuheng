import { BrowserWindow, dialog } from 'electron';
import { diagnoseBrowserUseEnvironment } from '../browser-use';
import { diagnoseComputerUseEnvironment, installComputerUseHelper, openComputerUsePermissionPane, type ComputerUsePermissionKind } from '../computer-use';
import type { SecretStore } from '../secrets';
import {
  DEFAULT_PROVIDER_CONTEXT_WINDOW,
  MAX_PROVIDER_CONTEXT_WINDOW,
  MIN_PROVIDER_CONTEXT_WINDOW,
  type AppStore,
  type BrowserUseConfig,
  type ComputerUseConfig,
  type ProviderConfig,
} from '../store';
import { testProviderConnection, type ProviderTestResult } from '../provider-test';
import { importSkill, listSkills, type UserSkillRegistration } from '../skills';
import { assertText } from './ipc-input';
import type { DomainIpcRegistrar } from './secured-ipc-registrar';

type ProviderStore = Pick<AppStore,
  | 'getProvider' | 'listProviders' | 'deleteProvider' | 'saveProvider' | 'defaultProviderId' | 'setDefaultProviderId'
  | 'getBrowserUseConfig' | 'saveBrowserUseConfig' | 'getComputerUseConfig' | 'saveComputerUseConfig'
  | 'getSkillRegistrations' | 'saveSkillRegistrations'
>;

export type ProviderIpcDependencies = {
  registrar: DomainIpcRegistrar;
  store: ProviderStore;
  secrets: SecretStore;
};

function providerProtocol(value: unknown): ProviderConfig['protocol'] {
  if (value === 'anthropic' || value === 'openai') return value;
  throw new Error('Unsupported provider protocol.');
}

export function registerProviderIpc({ registrar, store, secrets }: ProviderIpcDependencies): void {
  registrar.main('provider:get', () => {
    const provider = store.getProvider();
    return provider ? { ...provider, hasApiKey: secrets.hasProviderKey(provider.id ?? 'default') } : null;
  });
  registrar.main('provider:list', () => store.listProviders().map((provider) => ({ ...provider, hasApiKey: secrets.hasProviderKey(provider.id ?? 'default') })));
  registrar.main('provider:default-get', () => store.defaultProviderId());
  registrar.main('provider:default-save', (_event, providerId: unknown) => store.setDefaultProviderId(assertText(providerId, 'providerId')));
  registrar.main('provider:delete', (_event, providerId: unknown) => {
    const id = assertText(providerId, 'providerId'); store.deleteProvider(id); secrets.deleteProviderKey(id);
  });
  registrar.main('provider:save', (_event, raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new Error('Provider configuration is required.');
    const input = raw as Record<string, unknown>;
    const protocol = providerProtocol(input.protocol);
    const contextWindow = input.contextWindow == null ? DEFAULT_PROVIDER_CONTEXT_WINDOW : Number(input.contextWindow);
    if (!Number.isInteger(contextWindow) || contextWindow < MIN_PROVIDER_CONTEXT_WINDOW || contextWindow > MAX_PROVIDER_CONTEXT_WINDOW) throw new Error(`上下文窗口必须是 ${MIN_PROVIDER_CONTEXT_WINDOW.toLocaleString()} 到 ${MAX_PROVIDER_CONTEXT_WINDOW.toLocaleString()} 之间的整数。`);
    const providerId = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : undefined;
    const config = {
      ...(providerId ? { id: providerId } : {}),
      protocol,
      baseUrl: assertText(input.baseUrl, 'baseUrl').replace(/\/$/, ''),
      model: assertText(input.model, 'model'),
      displayName: assertText(input.displayName, 'displayName'),
      contextWindow,
      supportsImages: input.supportsImages === true,
    } satisfies Omit<ProviderConfig, 'hasApiKey' | 'id'> & { id?: string };
    const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
    if (!apiKey && (!providerId || !secrets.hasProviderKey(providerId))) throw new Error('API key is required.');
    const saved = store.saveProvider(config);
    const savedId = assertText(saved.id, 'providerId');
    if (apiKey) secrets.saveProviderKey(savedId, apiKey);
    return { ...saved, id: savedId, hasApiKey: secrets.hasProviderKey(savedId) };
  });
  registrar.main('provider:test', async (_event, raw: unknown): Promise<ProviderTestResult> => {
    if (!raw || typeof raw !== 'object') throw new Error('Provider configuration is required.');
    const input = raw as Record<string, unknown>;
    const protocol = providerProtocol(input.protocol);
    const providerId = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : undefined;
    const apiKey = typeof input.apiKey === 'string' && input.apiKey.trim() ? input.apiKey.trim() : providerId ? secrets.getProviderKey(providerId) : null;
    if (!apiKey) throw new Error('API key is required.');
    const config: ProviderConfig = { id: providerId ?? 'test', protocol, baseUrl: assertText(input.baseUrl, 'baseUrl').replace(/\/$/, ''), model: assertText(input.model, 'model'), displayName: typeof input.displayName === 'string' ? input.displayName : '测试 Provider', contextWindow: Number(input.contextWindow) || DEFAULT_PROVIDER_CONTEXT_WINDOW, supportsImages: input.supportsImages === true, hasApiKey: true };
    return testProviderConnection(config, apiKey);
  });
  registrar.main('browser-use:get', (): BrowserUseConfig => store.getBrowserUseConfig());
  registrar.main('browser-use:diagnose', () => diagnoseBrowserUseEnvironment());
  registrar.main('browser-use:save', async (_event, raw: unknown): Promise<BrowserUseConfig> => {
    if (!raw || typeof raw !== 'object' || typeof (raw as Record<string, unknown>).enabled !== 'boolean') throw new Error('Browser Use enabled state is required.');
    return store.saveBrowserUseConfig({ enabled: (raw as Record<string, unknown>).enabled === true });
  });
  registrar.main('computer-use:get', (): ComputerUseConfig => store.getComputerUseConfig());
  registrar.main('skills:list', () => listSkills(undefined, store.getSkillRegistrations()));
  registrar.main('skills:choose', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const result = owner
      ? await dialog.showOpenDialog(owner, { properties: ['openFile', 'openDirectory'], filters: [{ name: 'Skill', extensions: ['md'] }] })
      : await dialog.showOpenDialog({ properties: ['openFile', 'openDirectory'], filters: [{ name: 'Skill', extensions: ['md'] }] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  registrar.main('skills:import', (_event, rawPath: unknown) => {
    if (typeof rawPath !== 'string' || !rawPath.trim()) throw new Error('请选择 Skill 目录或 SKILL.md。');
    const imported = importSkill(rawPath.trim());
    const current = store.getSkillRegistrations().find((skill) => skill.path === imported.path);
    const registrations = store.getSkillRegistrations().filter((skill) => skill.path !== imported.path);
    return store.saveSkillRegistrations([{ ...imported, ...(current ? { id: current.id, enabled: current.enabled } : {}) }, ...registrations]);
  });
  registrar.main('skills:save', (_event, raw: unknown) => {
    if (!Array.isArray(raw)) throw new Error('Skill 配置格式无效。');
    const existing = store.getSkillRegistrations();
    const next = raw.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const value = item as Record<string, unknown>;
      const current = existing.find((skill) => skill.id === value.id);
      if (!current) return [];
      return [{ ...current, enabled: value.enabled === true } satisfies UserSkillRegistration];
    });
    return store.saveSkillRegistrations(next);
  });
  registrar.main('skills:delete', (_event, rawId: unknown) => {
    const id = assertText(rawId, 'skillId');
    return store.saveSkillRegistrations(store.getSkillRegistrations().filter((skill) => skill.id !== id));
  });
  registrar.main('computer-use:diagnose', () => diagnoseComputerUseEnvironment());
  registrar.main('computer-use:open-permission', async (_event, rawKind: unknown) => {
    if (rawKind !== 'accessibility' && rawKind !== 'screenRecording') throw new Error('未知的 Computer Use 权限类型。');
    await openComputerUsePermissionPane(rawKind as ComputerUsePermissionKind);
  });
  registrar.main('computer-use:install', async () => {
    const before = await diagnoseComputerUseEnvironment();
    if (before.platform !== 'darwin' || before.arch !== 'arm64') return before;
    await installComputerUseHelper();
    return diagnoseComputerUseEnvironment();
  });
  registrar.main('computer-use:save', async (_event, raw: unknown): Promise<ComputerUseConfig> => {
    if (!raw || typeof raw !== 'object' || typeof (raw as Record<string, unknown>).enabled !== 'boolean') throw new Error('Computer Use enabled state is required.');
    return store.saveComputerUseConfig({ enabled: (raw as Record<string, unknown>).enabled === true });
  });
}
