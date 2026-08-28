import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, ArchiveRestore, ArrowLeft, BrainCircuit, CalendarCheck2, CalendarClock, ChevronDown, Download, Info, KeyRound, Palette, PanelLeftOpen, Upload, X } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Composer } from '../features/conversation/workspace/composer';
import { ConversationStart } from '../features/conversation/workspace/conversation-start';
import { Sidebar, type Conversation as SidebarConversation } from '../features/conversation/workspace/sidebar';
import { Transcript, type ToolActivity, type TranscriptMessage } from '../features/conversation/workspace/transcript';
import { GlobalSearch } from '../features/search/global-search';
import { AGENT_PROFILES, DEFAULT_AGENT_PROFILE_ID, type AgentProfileId, type AppInfo, type Attachment, type BrowserUseConfig, type ComputerUseConfig, type ConversationProject, type CreateTaskInput, type DesktopBridge, type Message, type ProviderConfig, type ProviderProtocol, type ProviderTestResult, type ReasoningLevel, type ReasoningSelection, type RunEvent, type RunSummary, type SearchResult, type Task, type TaskAsset, type TaskBoard, type TaskEvent, type TaskType, type UpdateTaskInput } from '../contracts/desktop-bridge';
import { releaseNotes } from '../features/settings/releases';
import { listTodayTasks, todayTaskKindLabel, type TodayTask } from '../features/tasks/today-overview';

const TaskBoard = lazy(() => import('../features/tasks/task-board').then((module) => ({ default: module.TaskBoard })));

type ThemeName = 'dark' | 'light' | 'graphite' | 'notion';
type SettingsSection = 'provider' | 'capabilities' | 'appearance' | 'backup' | 'about';

const fallbackConversations: SidebarConversation[] = [
  { id: 'inbox', projectId: 'personal', title: '收件箱', time: '现在', pinned: false },
  { id: 'weekly-plan', projectId: 'personal', title: '本周计划', time: '昨天', pinned: false },
  { id: 'research', projectId: 'personal', title: '资料整理', time: '周一', pinned: false },
];
const fallbackProjects: ConversationProject[] = [{ id: 'personal', name: '个人事务', position: 0 }];
const fallbackMessages: Record<string, TranscriptMessage[]> = {
  inbox: [],
  'weekly-plan': [{ id: 'weekly-1', role: 'user', content: '帮我整理一下本周最重要的三件事。', time: '昨天 18:42' }, { id: 'weekly-2', role: 'assistant', content: '可以。先从已经确认的事项开始：项目发布、供应商跟进和周五的复盘。', time: '昨天 18:43' }],
  research: [{ id: 'research-1', role: 'user', content: '把上次收集的资料按主题分一下。', time: '周一 10:16' }, { id: 'research-2', role: 'assistant', content: '我先按“产品、技术、待确认”三个主题归类，待确认的内容单独列出。', time: '周一 10:17' }],
};

const getBridge = (): DesktopBridge | undefined => (typeof window !== 'undefined' ? window.desktopBridge : undefined);
function displayMessage(message: Message): TranscriptMessage {
  return { ...message, time: new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) };
}

function shortId(id: string): string {
  return id.length > 12 ? id.slice(0, 8) : id;
}

function compactTokens(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`;
  return value.toLocaleString('zh-CN');
}

function sortConversations(items: SidebarConversation[]): SidebarConversation[] {
  return [...items].sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) || (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''));
}

function SidebarExpandControl({ onExpand }: { onExpand: () => void }) {
  return <div className="sidebar-expand-control">
    <button type="button" className="collapsed-sidebar-toggle" onClick={onExpand} aria-label="展开侧栏" title="展开侧栏"><PanelLeftOpen size={17} aria-hidden="true" /></button>
  </div>;
}

function ContextWindowStatus({ usage, refreshing }: { usage: RunSummary['usage']; refreshing: boolean }) {
  const available = usage?.contextTokens != null && usage.contextWindow > 0;
  const percent = available ? Math.min(100, Math.max(0, usage.contextTokens! / usage.contextWindow * 100)) : 0;
  const value = available ? `${compactTokens(usage.contextTokens!)} / ${compactTokens(usage.contextWindow)}` : '暂无数据';
  const detail = available
    ? `当前会话上下文：${usage.contextTokens!.toLocaleString('zh-CN')} / ${usage.contextWindow.toLocaleString('zh-CN')} tokens（${Math.round(percent)}%）${refreshing ? '；本轮完成后更新' : ''}`
    : `当前会话上下文暂无可靠数据${refreshing ? '，本轮完成后更新' : ''}`;
  return <div className={`context-window-status ${available ? '' : 'is-empty'} ${refreshing ? 'is-refreshing' : ''}`} aria-label={detail} title={detail}>
    <div className="context-window-copy"><span>上下文</span><strong>{value}</strong>{available && <small>{Math.round(percent)}%</small>}</div>
    <div className="context-window-meter" aria-hidden="true"><span style={{ width: `${percent}%` }} /></div>
  </div>;
}

function platformLabel(appInfo: AppInfo | null): string {
  if (!appInfo) return '正在读取版本信息...';
  const platform = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }[appInfo.platform] ?? appInfo.platform;
  const arch = { arm64: 'Apple Silicon', x64: 'Intel x64' }[appInfo.arch] ?? appInfo.arch;
  return `${platform} · ${arch}`;
}

function SettingsWorkspace({ appInfo, current, providers, browserUseConfig, computerUseConfig, theme, onThemeChange, onClose, onSaved, onProvidersChange, onBrowserUseChange, onComputerUseChange }: { appInfo: AppInfo | null; current: ProviderConfig | null; providers: ProviderConfig[]; browserUseConfig: BrowserUseConfig; computerUseConfig: ComputerUseConfig; theme: ThemeName; onThemeChange: (theme: ThemeName) => void; onClose: () => void; onSaved: (provider: ProviderConfig) => void; onProvidersChange: (providers: ProviderConfig[]) => void; onBrowserUseChange: (config: BrowserUseConfig) => void; onComputerUseChange: (config: ComputerUseConfig) => void }) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('provider');
  const [protocol, setProtocol] = useState<ProviderProtocol>(current?.protocol ?? 'openai');
  const [editingProviderId, setEditingProviderId] = useState(current?.id ?? '');
  const [baseUrl, setBaseUrl] = useState(current?.baseUrl ?? 'https://api.openai.com/v1');
  const [model, setModel] = useState(current?.model ?? 'gpt-4o-mini');
  const [displayName, setDisplayName] = useState(current?.displayName ?? '默认模型');
  const [contextWindow, setContextWindow] = useState(String(current?.contextWindow ?? 200_000));
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [browserSaving, setBrowserSaving] = useState(false);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [computerSaving, setComputerSaving] = useState(false);
  const [computerError, setComputerError] = useState<string | null>(null);
  const [providerTesting, setProviderTesting] = useState(false);
  const [providerTestResult, setProviderTestResult] = useState<ProviderTestResult | null>(null);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const activeBridge = getBridge();
    if (!activeBridge) return;
    setError(null);
    try {
      const saved = await activeBridge.provider.save({ id: editingProviderId || undefined, protocol, baseUrl, model, displayName, contextWindow: Number(contextWindow), apiKey });
      setApiKey('');
      setEditingProviderId(saved.id);
      onSaved(saved);
      onProvidersChange(await activeBridge.provider.list());
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败。'); }
  };
  const selectProvider = (provider: ProviderConfig) => { setEditingProviderId(provider.id); setProtocol(provider.protocol); setBaseUrl(provider.baseUrl); setModel(provider.model); setDisplayName(provider.displayName); setContextWindow(String(provider.contextWindow)); setApiKey(''); setError(null); setProviderTestResult(null); };
  const addProvider = () => { setEditingProviderId(''); setProtocol('openai'); setBaseUrl('https://api.openai.com/v1'); setModel('gpt-4o-mini'); setDisplayName('新模型'); setContextWindow('200000'); setApiKey(''); setError(null); setProviderTestResult(null); };
  const testConnection = async () => {
    const activeBridge = getBridge();
    if (!activeBridge || providerTesting) return;
    setProviderTesting(true); setProviderTestResult(null); setError(null);
    try { setProviderTestResult(await activeBridge.provider.test({ id: editingProviderId || undefined, protocol, baseUrl, model, displayName, contextWindow: Number(contextWindow), apiKey })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '测试连接失败。'); }
    finally { setProviderTesting(false); }
  };
  const removeProvider = async (provider: ProviderConfig) => { const activeBridge = getBridge(); if (!activeBridge || !window.confirm(`删除 Provider“${provider.displayName}”？`)) return; try { await activeBridge.provider.delete(provider.id); const next = await activeBridge.provider.list(); onProvidersChange(next); if (next[0]) selectProvider(next[0]); else addProvider(); } catch (reason) { setError(reason instanceof Error ? reason.message : '删除 Provider 失败。'); } };
  const toggleBrowserUse = async () => {
    const activeBridge = getBridge();
    if (!activeBridge || browserSaving) return;
    setBrowserSaving(true);
    setBrowserError(null);
    try {
      const saved = await activeBridge.browserUse.save({ enabled: !browserUseConfig.enabled });
      onBrowserUseChange(saved);
      if (saved.enabled) onComputerUseChange({ enabled: false });
    }
    catch (reason) { setBrowserError(reason instanceof Error ? reason.message : '更新 Browser Use 设置失败。'); }
    finally { setBrowserSaving(false); }
  };
  const toggleComputerUse = async () => {
    const activeBridge = getBridge();
    if (!activeBridge || computerSaving) return;
    setComputerSaving(true);
    setComputerError(null);
    try {
      const saved = await activeBridge.computerUse.save({ enabled: !computerUseConfig.enabled });
      onComputerUseChange(saved);
      if (saved.enabled) onBrowserUseChange({ enabled: false });
    } catch (reason) { setComputerError(reason instanceof Error ? reason.message : '更新 Computer Use 设置失败。'); }
    finally { setComputerSaving(false); }
  };
  const sectionCopy: Record<SettingsSection, { title: string; description: string }> = {
    provider: { title: '模型服务', description: '配置玉衡用于会话和任务处理的语言模型。' },
    capabilities: { title: 'Agent 能力', description: '管理需要额外运行环境或系统权限的可选能力。' },
    appearance: { title: '界面外观', description: '调整玉衡在这台设备上的显示方式。' },
    backup: { title: '数据备份', description: '导出或导入这台 Mac 上的玉衡数据。' },
    about: { title: '关于玉衡', description: '查看当前安装版本和历次版本更新。' },
  };
  const page = sectionCopy[activeSection];

  return <section className="settings-layout" aria-label="玉衡设置">
    <aside className="settings-navigation">
      <div className="settings-navigation-brand"><strong>玉衡</strong><span>设置</span></div>
      <nav aria-label="设置页面">
        <span className="settings-navigation-label">配置</span>
        <button type="button" className={activeSection === 'provider' ? 'is-selected' : ''} aria-current={activeSection === 'provider' ? 'page' : undefined} onClick={() => setActiveSection('provider')}><KeyRound size={15} aria-hidden="true" /><span>模型服务</span></button>
        <button type="button" className={activeSection === 'capabilities' ? 'is-selected' : ''} aria-current={activeSection === 'capabilities' ? 'page' : undefined} onClick={() => setActiveSection('capabilities')}><BrainCircuit size={15} aria-hidden="true" /><span>Agent 能力</span></button>
        <span className="settings-navigation-label">应用</span>
        <button type="button" className={activeSection === 'appearance' ? 'is-selected' : ''} aria-current={activeSection === 'appearance' ? 'page' : undefined} onClick={() => setActiveSection('appearance')}><Palette size={15} aria-hidden="true" /><span>界面外观</span></button>
        <button type="button" className={activeSection === 'backup' ? 'is-selected' : ''} aria-current={activeSection === 'backup' ? 'page' : undefined} onClick={() => setActiveSection('backup')}><ArchiveRestore size={15} aria-hidden="true" /><span>数据备份</span></button>
        <button type="button" className={activeSection === 'about' ? 'is-selected' : ''} aria-current={activeSection === 'about' ? 'page' : undefined} onClick={() => setActiveSection('about')}><Info size={15} aria-hidden="true" /><span>关于玉衡</span></button>
      </nav>
      <button type="button" className="settings-navigation-back" onClick={onClose}><ArrowLeft size={15} aria-hidden="true" /><span>返回工作区</span></button>
    </aside>

    <section className="settings-page" aria-labelledby="settings-page-title">
      <header className="settings-page-header">
        <div><h2 id="settings-page-title">{page.title}</h2><p>{page.description}</p></div>
        <button type="button" className="settings-close" onClick={onClose} aria-label="关闭设置" title="关闭设置"><X size={18} aria-hidden="true" /></button>
      </header>

      {activeSection === 'provider' && <div className="settings-section settings-section-first"><div className="settings-section-heading"><div><h3>语言模型 Provider</h3><p>API Key 仅保存在这台 Mac 的钥匙串中。</p></div><button type="button" className="secondary-action" onClick={addProvider}>新增 Provider</button></div><div className="provider-profile-list">{providers.map((provider) => <div className={`provider-profile-row ${provider.id === editingProviderId ? 'is-selected' : ''}`} key={provider.id}><button type="button" onClick={() => selectProvider(provider)}><strong>{provider.displayName}</strong><small>{provider.protocol} · {provider.model}{provider.id === current?.id ? ' · 当前会话' : ''}</small></button><button type="button" className="icon-button" onClick={() => void removeProvider(provider)} aria-label={`删除 ${provider.displayName}`}>×</button></div>)}</div>
        <form onSubmit={save}>
          <label>协议<select value={protocol} onChange={(event) => setProtocol(event.target.value as ProviderProtocol)}><option value="openai">OpenAI-compatible</option><option value="anthropic">Anthropic Messages</option></select></label>
          <label>显示名称<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label>
          <label>Base URL<input type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required /></label>
          <label>模型<input value={model} onChange={(event) => setModel(event.target.value)} required /></label>
          <label>上下文窗口<div className="settings-input-stack"><input type="number" min="4096" max="10000000" step="1" value={contextWindow} onChange={(event) => setContextWindow(event.target.value)} required /><small>以 token 计；默认 200,000，新一轮会话开始时生效。</small></div></label>
          <label>API Key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={current?.hasApiKey ? '已配置，留空则保持不变' : '输入 API Key'} autoComplete="off" /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="provider-modal-actions"><button type="button" className="secondary-action" onClick={() => void testConnection()} disabled={providerTesting}>{providerTesting ? '测试中…' : '测试连接'}</button><button type="submit" className="send-button">保存 Provider</button></div>
          {providerTestResult && <p className={`provider-test-result ${providerTestResult.ok ? 'is-success' : 'is-failure'}`} role="status">{providerTestResult.ok ? `连接成功 · HTTP ${providerTestResult.status ?? '-'} · ${providerTestResult.latencyMs}ms` : `连接失败${providerTestResult.status ? ` · HTTP ${providerTestResult.status}` : ''} · ${providerTestResult.error ?? '请检查配置。'}`}</p>}
        </form>
      </div>}

      {activeSection === 'capabilities' && <>
        <div className="settings-section settings-section-first"><div className="settings-section-heading"><div><h3>Browser Use</h3><p>允许模型按需使用隔离浏览器；点击、填写和关闭标签页仍需单次确认。</p></div><span className={`settings-state ${browserUseConfig.enabled ? 'is-ready' : ''}`}>{browserUseConfig.enabled ? '已启用' : '已关闭'}</span></div><div className="plugin-toggle-row"><div><strong>浏览器自动化</strong><small>与 Computer Use 二选一；关闭时不注入工具，也不启动 Python 或 Chrome。</small></div><button type="button" className={`switch-control ${browserUseConfig.enabled ? 'is-on' : ''}`} role="switch" aria-checked={browserUseConfig.enabled} aria-label={browserUseConfig.enabled ? '关闭 Browser Use' : '开启 Browser Use'} onClick={() => void toggleBrowserUse()} disabled={browserSaving}><span /></button></div>{browserError && <p className="form-error" role="alert">{browserError}</p>}</div>
        <div className="settings-section"><div className="settings-section-heading"><div><h3>Computer Use</h3><p>让模型观察并操作桌面界面，也可使用受控浏览器。</p></div><span className={`settings-state ${computerUseConfig.enabled ? 'is-ready' : ''}`}>{computerUseConfig.enabled ? '已启用' : '已关闭'}</span></div><div className="plugin-toggle-row"><div><strong>桌面自动化</strong><small>与 Browser Use 二选一；桌面、浏览器和脚本操作会逐次请求确认。</small></div><button type="button" className={`switch-control ${computerUseConfig.enabled ? 'is-on' : ''}`} role="switch" aria-checked={computerUseConfig.enabled} aria-label={computerUseConfig.enabled ? '关闭 Computer Use' : '开启 Computer Use'} onClick={() => void toggleComputerUse()} disabled={computerSaving}><span /></button></div>{computerError && <p className="form-error" role="alert">{computerError}</p>}</div>
      </>}

      {activeSection === 'appearance' && <div className="settings-section settings-section-first appearance-section"><div className="settings-section-heading"><div><h3>主题</h3><p>选择玉衡工作区的基础配色。</p></div></div><div className="theme-options" role="radiogroup" aria-label="界面配色"><button type="button" className={`theme-option ${theme === 'dark' ? 'is-selected' : ''}`} onClick={() => onThemeChange('dark')} role="radio" aria-checked={theme === 'dark'}><span className="theme-swatch theme-swatch-dark" /><span><strong>深色</strong><small>适合长时间专注</small></span></button><button type="button" className={`theme-option ${theme === 'light' ? 'is-selected' : ''}`} onClick={() => onThemeChange('light')} role="radio" aria-checked={theme === 'light'}><span className="theme-swatch theme-swatch-light" /><span><strong>浅色</strong><small>明亮清晰</small></span></button><button type="button" className={`theme-option ${theme === 'graphite' ? 'is-selected' : ''}`} onClick={() => onThemeChange('graphite')} role="radio" aria-checked={theme === 'graphite'}><span className="theme-swatch theme-swatch-graphite" /><span><strong>石墨灰</strong><small>低对比度</small></span></button><button type="button" className={`theme-option ${theme === 'notion' ? 'is-selected' : ''}`} onClick={() => onThemeChange('notion')} role="radio" aria-checked={theme === 'notion'}><span className="theme-swatch theme-swatch-notion" /><span><strong>Notion</strong><small>温和中性</small></span></button></div></div>}

      {activeSection === 'backup' && <BackupSettings />}

      {activeSection === 'about' && <div className="settings-section settings-section-first about-section">
        <div className="about-product"><div><strong>玉衡</strong><span>{appInfo ? `版本 v${appInfo.version}` : '版本信息读取中'}</span></div><small>{platformLabel(appInfo)}</small></div>
        <div className="release-list" aria-label="版本更新日志">
          {releaseNotes.map((release, index) => <details key={release.version} open={index === 0 ? true : undefined}>
            <summary><span className="release-version">v{release.version}{appInfo?.version === release.version && <small>当前版本</small>}</span><strong>{release.title}</strong><ChevronDown size={15} aria-hidden="true" /></summary>
            <ul>{release.changes.map((change) => <li key={change}>{change}</li>)}</ul>
          </details>)}
        </div>
      </div>}
    </section>
  </section>;
}

function BackupSettings() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [config, setConfig] = useState<{ enabled: boolean; directory: string; retention: number; lastRunAt: string | null; lastError: string | null } | null>(null);
  useEffect(() => { const bridge = getBridge(); if (bridge) void bridge.backup.getConfig().then(setConfig).catch(() => undefined); }, []);
  const exportBackup = async () => {
    const bridge = getBridge(); if (!bridge || busy) return;
    setBusy(true); setStatus(null);
    try { const file = await bridge.backup.export(); if (file) setStatus(`备份已保存：${file}`); }
    catch (error) { setStatus(error instanceof Error ? error.message : '导出备份失败。'); }
    finally { setBusy(false); }
  };
  const importBackup = async () => {
    const bridge = getBridge(); if (!bridge || busy) return;
    setBusy(true); setStatus(null);
    try { const report = await bridge.backup.import(); if (report) setStatus(`已导入 ${report.conversations} 个会话、${report.messages} 条消息和 ${report.tasks} 个任务${report.missingProviders ? `；${report.missingProviders} 个 Provider 需要重新配置` : ''}${report.contextUnavailable ? '；部分 Agent 上下文未恢复' : ''}。`); }
    catch (error) { setStatus(error instanceof Error ? error.message : '导入备份失败。'); }
    finally { setBusy(false); }
  };
  const toggleAutomatic = async () => { const bridge = getBridge(); if (!bridge || !config) return; const saved = await bridge.backup.saveConfig({ enabled: !config.enabled, directory: config.directory, retention: config.retention }); setConfig(saved); };
  return <div className="settings-section settings-section-first"><div className="settings-section-heading"><div><h3>完整备份</h3><p>包含会话、任务、运行记录和受控附件，不包含 API Key 或 workspace 文件。备份文件未加密，请妥善保管。</p></div></div><div className="provider-modal-actions"><button type="button" className="secondary-action" onClick={() => void importBackup()} disabled={busy}>导入 .yuheng</button><button type="button" className="send-button" onClick={() => void exportBackup()} disabled={busy}>{busy ? '处理中…' : '导出完整备份'}</button></div><div className="plugin-toggle-row"><div><strong>自动备份</strong><small>每天最多一次；检测到运行中任务时跳过本轮。</small></div><button type="button" className={`switch-control ${config?.enabled ? 'is-on' : ''}`} role="switch" aria-checked={config?.enabled ?? false} aria-label="开启自动备份" onClick={() => void toggleAutomatic()} disabled={!config || busy}><span /></button></div>{config?.lastRunAt && <small>最近成功：{new Date(config.lastRunAt).toLocaleString('zh-CN')}</small>}{config?.lastError && <p className="form-error" role="alert">{config.lastError}</p>}{status && <p className="provider-test-result" role="status">{status}</p>}</div>;
}

export function ProductionRenderer() {
  const activeBridge = getBridge();
  const [conversationItems, setConversationItems] = useState<SidebarConversation[]>(fallbackConversations);
  const [conversationProjects, setConversationProjects] = useState<ConversationProject[]>(fallbackProjects);
  const [activeConversation, setActiveConversation] = useState('inbox');
  const [activeConversationProject, setActiveConversationProject] = useState('personal');
  const [activeView, setActiveViewState] = useState<'conversation' | 'tasks'>('conversation');
  const setActiveView = (next: 'conversation' | 'tasks') => {
    if (typeof document === 'undefined') { setActiveViewState(next); return; }
    const viewTransitionDocument = document as Document & { startViewTransition?: (callback: () => void) => unknown };
    if (viewTransitionDocument.startViewTransition) viewTransitionDocument.startViewTransition(() => setActiveViewState(next));
    else setActiveViewState(next);
  };
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const [messages, setMessages] = useState<Record<string, TranscriptMessage[]>>(fallbackMessages);
  const [activeRun, setActiveRun] = useState<{ id: string; conversationId: string } | null>(null);
  const [toolActivities, setToolActivities] = useState<Record<string, ToolActivity[]>>({});
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [provider, setProvider] = useState<ProviderConfig | null>(null);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [newProviderId, setNewProviderId] = useState('');
  const [activeProfileId, setActiveProfileId] = useState<AgentProfileId>(DEFAULT_AGENT_PROFILE_ID);
  const [profileMenuOpen, setProfileMenuOpenState] = useState(false);
  const [providerMenuOpen, setProviderMenuOpenState] = useState(false);
  const [profileMenuClosing, setProfileMenuClosing] = useState(false);
  const [providerMenuClosing, setProviderMenuClosing] = useState(false);
  const profileMenuCloseTimerRef = useRef<number | null>(null);
  const providerMenuCloseTimerRef = useRef<number | null>(null);
  const setProfileMenuOpen = (next: boolean | ((current: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(profileMenuOpen) : next;
    if (profileMenuCloseTimerRef.current !== null) window.clearTimeout(profileMenuCloseTimerRef.current);
    if (value) { setProfileMenuClosing(false); setProfileMenuOpenState(true); return; }
    if (!profileMenuOpen) return;
    setProfileMenuClosing(true);
    profileMenuCloseTimerRef.current = window.setTimeout(() => { setProfileMenuOpenState(false); setProfileMenuClosing(false); profileMenuCloseTimerRef.current = null; }, 125);
  };
  const setProviderMenuOpen = (next: boolean | ((current: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(providerMenuOpen) : next;
    if (providerMenuCloseTimerRef.current !== null) window.clearTimeout(providerMenuCloseTimerRef.current);
    if (value) { setProviderMenuClosing(false); setProviderMenuOpenState(true); return; }
    if (!providerMenuOpen) return;
    setProviderMenuClosing(true);
    providerMenuCloseTimerRef.current = window.setTimeout(() => { setProviderMenuOpenState(false); setProviderMenuClosing(false); providerMenuCloseTimerRef.current = null; }, 125);
  };
  const [browserUseConfig, setBrowserUseConfig] = useState<BrowserUseConfig>({ enabled: false });
  const [computerUseConfig, setComputerUseConfig] = useState<ComputerUseConfig>({ enabled: false });
  const [reasoningSelection, setReasoningSelection] = useState<ReasoningSelection>('default');
  const [providerOpen, setProviderOpen] = useState(false);
  const [settingsMounted, setSettingsMounted] = useState(false);
  const [settingsClosing, setSettingsClosing] = useState(false);
  const settingsCloseTimerRef = useRef<number | null>(null);
  const settingsMountedRef = useRef(false);
  const settingsClosingRef = useRef(false);
  const [pendingApproval, setPendingApproval] = useState<Extract<RunEvent, { type: 'approval_required' }> | null>(null);
  const [approvalClosing, setApprovalClosing] = useState(false);
  const approvalCloseTimerRef = useRef<number | null>(null);
  const [copiedConversationId, setCopiedConversationId] = useState(false);
  const [theme, setTheme] = useState<ThemeName>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('yuheng-theme') : null;
    return saved === 'light' || saved === 'graphite' || saved === 'notion' ? saved : 'dark';
  });
  const [error, setError] = useState<string | null>(null);
  const [interruptedRun, setInterruptedRun] = useState<RunSummary | null>(null);
  const [conversationRuns, setConversationRuns] = useState<Record<string, RunSummary[]>>({});
  const [retryDraft, setRetryDraft] = useState<{ messageId: string; content: string } | null>(null);
  const [retryingRun, setRetryingRun] = useState(false);
  const retryingRunRef = useRef(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [taskBoards, setTaskBoards] = useState<TaskBoard[]>([]);
  const [activeTaskBoardId, setActiveTaskBoardId] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [todayTasks, setTodayTasks] = useState<TodayTask[]>([]);
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([]);
  const [tasksLoading, setTasksLoading] = useState(Boolean(activeBridge));
  const [requestedOpenTaskId, setRequestedOpenTaskId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [requestedMessageId, setRequestedMessageId] = useState<string | null>(null);
  const [composerPrefill, setComposerPrefill] = useState<{ id: number; value: string } | null>(null);

  const dismissApproval = () => {
    if (!pendingApproval) return;
    setApprovalClosing(true);
    if (approvalCloseTimerRef.current !== null) window.clearTimeout(approvalCloseTimerRef.current);
    approvalCloseTimerRef.current = window.setTimeout(() => {
      setPendingApproval(null);
      setApprovalClosing(false);
      approvalCloseTimerRef.current = null;
    }, 170);
  };

  const openSettings = () => {
    if (settingsCloseTimerRef.current !== null) window.clearTimeout(settingsCloseTimerRef.current);
    settingsMountedRef.current = true;
    settingsClosingRef.current = false;
    setSettingsMounted(true);
    setSettingsClosing(false);
    setProviderOpen(true);
  };
  const closeSettings = () => {
    if (!settingsMountedRef.current || settingsClosingRef.current) return;
    setProviderOpen(false);
    settingsClosingRef.current = true;
    setSettingsClosing(true);
    if (settingsCloseTimerRef.current !== null) window.clearTimeout(settingsCloseTimerRef.current);
    settingsCloseTimerRef.current = window.setTimeout(() => {
      setSettingsMounted(false);
      setSettingsClosing(false);
      settingsMountedRef.current = false;
      settingsClosingRef.current = false;
      settingsCloseTimerRef.current = null;
    }, 190);
  };
  settingsMountedRef.current = settingsMounted;
  settingsClosingRef.current = settingsClosing;
  useEffect(() => () => {
    if (settingsCloseTimerRef.current !== null) window.clearTimeout(settingsCloseTimerRef.current);
    if (approvalCloseTimerRef.current !== null) window.clearTimeout(approvalCloseTimerRef.current);
    if (profileMenuCloseTimerRef.current !== null) window.clearTimeout(profileMenuCloseTimerRef.current);
    if (providerMenuCloseTimerRef.current !== null) window.clearTimeout(providerMenuCloseTimerRef.current);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('yuheng-theme', theme);
  }, [theme]);

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  useEffect(() => {
    if (!activeBridge) return;
    let mounted = true;
    void Promise.all([activeBridge.conversations.list(true), activeBridge.conversations.projects.list(), activeBridge.provider.get(), activeBridge.provider.list(), activeBridge.browserUse.get(), activeBridge.computerUse.get(), activeBridge.tasks.boards.list()]).then(([items, projects, configuredProvider, configuredProviders, configuredBrowserUse, configuredComputerUse, storedTaskBoards]) => {
      if (!mounted) return;
      setConversationItems(sortConversations(items));
      setConversationProjects(projects);
      setProvider(configuredProvider);
      setProviders(configuredProviders);
      setNewProviderId(configuredProvider?.id ?? configuredProviders[0]?.id ?? '');
      setBrowserUseConfig(configuredBrowserUse);
      setComputerUseConfig(configuredComputerUse);
      setTaskBoards(storedTaskBoards);
      setActiveTaskBoardId((current) => storedTaskBoards.some((board) => board.id === current) ? current : (storedTaskBoards[0]?.id ?? ''));
      const initialConversation = items.find((item) => !item.archived) ?? items[0];
      if (initialConversation) {
        setActiveConversation(initialConversation.id);
        setActiveConversationProject(initialConversation.projectId);
        setActiveProfileId(initialConversation.profileId ?? DEFAULT_AGENT_PROFILE_ID);
        if (initialConversation.providerId) setProvider(configuredProviders.find((item) => item.id === initialConversation.providerId) ?? configuredProvider);
      }
    }).catch((reason) => { if (mounted) { setTasksLoading(false); setError(reason instanceof Error ? reason.message : '加载本地数据失败。'); } });
    return () => { mounted = false; };
  }, [activeBridge]);

  useEffect(() => {
    if (!activeBridge) return;
    let mounted = true;
    void activeBridge.app.getInfo().then((info) => { if (mounted) setAppInfo(info); }).catch(() => { /* Settings keeps a neutral fallback when app metadata is unavailable. */ });
    return () => { mounted = false; };
  }, [activeBridge]);

  useEffect(() => {
    if (!activeBridge) return;
    let mounted = true;
    void activeBridge.reasoning.get(activeConversation).then((selection) => {
      if (mounted) setReasoningSelection(selection);
    }).catch((reason) => {
      if (mounted) setError(reason instanceof Error ? reason.message : '加载会话推理设置失败。');
    });
    return () => { mounted = false; };
  }, [activeBridge, activeConversation]);

  useEffect(() => {
    if (!profileMenuOpen && !providerMenuOpen) return;
    const closeHeaderMenus = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest('.conversation-profile-picker')) setProfileMenuOpen(false);
      if (!target?.closest('.conversation-provider-picker')) setProviderMenuOpen(false);
    };
    document.addEventListener('mousedown', closeHeaderMenus);
    return () => document.removeEventListener('mousedown', closeHeaderMenus);
  }, [profileMenuOpen, providerMenuOpen]);

  useEffect(() => {
    if (!activeBridge || !activeTaskBoardId) return;
    let mounted = true;
    setTasksLoading(true);
    setTasks([]);
    setTaskTypes([]);
    void Promise.all([activeBridge.tasks.list(activeTaskBoardId), activeBridge.tasks.types.list(activeTaskBoardId)]).then(([storedTasks, storedTaskTypes]) => {
      if (!mounted) return;
      setTasks(storedTasks);
      setTaskTypes(storedTaskTypes);
      setTasksLoading(false);
    }).catch((reason) => { if (mounted) { setTasksLoading(false); setError(reason instanceof Error ? reason.message : '加载任务看板失败。'); } });
    return () => { mounted = false; };
  }, [activeBridge, activeTaskBoardId]);

  useEffect(() => {
    if (!activeBridge || taskBoards.length === 0) {
      setTodayTasks([]);
      return;
    }
    let mounted = true;
    void Promise.all(taskBoards.map((board) => activeBridge.tasks.list(board.id))).then((boardTasks) => {
      if (mounted) setTodayTasks(listTodayTasks(boardTasks.flat()));
    }).catch((reason) => {
      if (mounted) setError(reason instanceof Error ? reason.message : '加载今日概览失败。');
    });
    return () => { mounted = false; };
  }, [activeBridge, taskBoards]);

  useEffect(() => {
    if (!activeBridge) return;
    const handleTaskEvent = (event: TaskEvent) => {
      if (event.type === 'changed') {
        if (event.task.boardId === activeTaskBoardId) setTasks((current) => [event.task, ...current.filter((task) => task.id !== event.task.id)]);
        void Promise.all(taskBoards.map((board) => activeBridge.tasks.list(board.id))).then((boardTasks) => setTodayTasks(listTodayTasks(boardTasks.flat()))).catch((reason) => setError(reason instanceof Error ? reason.message : '刷新今日概览失败。'));
      } else if (event.type === 'types_changed') {
        if (event.boardId === activeTaskBoardId) void activeBridge.tasks.types.list(activeTaskBoardId).then(setTaskTypes).catch((reason) => setError(reason instanceof Error ? reason.message : '加载任务类型失败。'));
      } else if (event.type === 'boards_changed') {
        void activeBridge.tasks.boards.list().then((boards) => {
          setTaskBoards(boards);
          setActiveTaskBoardId((current) => boards.some((board) => board.id === current) ? current : (boards[0]?.id ?? ''));
        }).catch((reason) => setError(reason instanceof Error ? reason.message : '加载任务看板失败。'));
      } else {
        closeSettings();
        setActiveView('tasks');
        setActiveTaskBoardId(event.boardId);
        setRequestedOpenTaskId(event.taskId);
      }
    };
    const unsubscribe = activeBridge.tasks.onEvent(handleTaskEvent);
    void activeBridge.tasks.takeOpenRequest().then((request) => {
      if (request) handleTaskEvent({ type: 'open', ...request });
    }).catch((reason) => setError(reason instanceof Error ? reason.message : '打开提醒任务失败。'));
    return unsubscribe;
  }, [activeBridge, activeTaskBoardId, taskBoards]);

  useEffect(() => {
    if (!activeBridge) return;
    let mounted = true;
    void Promise.all([activeBridge.conversations.messages(activeConversation), activeBridge.runs.list(activeConversation)]).then(([items, runs]) => {
      if (!mounted) return;
      setMessages((current) => ({ ...current, [activeConversation]: items.map(displayMessage) }));
      const interrupted = runs.find((run) => run.status === 'interrupted');
      setInterruptedRun(interrupted ?? null);
      setConversationRuns((current) => ({ ...current, [activeConversation]: runs }));
      setToolActivities((current) => ({ ...current, [activeConversation]: runs.flatMap((run) => run.activities).map((activity) => ({ id: activity.id, toolName: activity.toolName, status: activity.status, input: activity.input ?? undefined, output: activity.output ?? undefined, startedAt: activity.startedAt, finishedAt: activity.finishedAt, artifacts: activity.artifacts })) }));
    }).catch((reason) => { if (mounted) setError(reason instanceof Error ? reason.message : '加载会话失败。'); });
    return () => { mounted = false; };
  }, [activeBridge, activeConversation]);

  useEffect(() => {
    if (!activeBridge) return;
    return activeBridge.runs.onEvent((event: RunEvent) => {
      if (event.type === 'accepted') {
        setActiveRun({ id: event.runId, conversationId: event.conversationId });
        return;
      }
      if (event.type === 'tool_start') {
        setToolActivities((current) => ({ ...current, [event.conversationId]: [...(current[event.conversationId] ?? []), { id: event.toolCallId, toolName: event.toolName, status: 'running', input: event.input, startedAt: new Date().toISOString() }] }));
        return;
      }
      if (event.type === 'tool_end') {
        setToolActivities((current) => ({ ...current, [event.conversationId]: (current[event.conversationId] ?? []).map((activity) => activity.id === event.toolCallId ? { ...activity, toolName: event.toolName, status: event.isError ? 'failed' : 'completed', output: event.output, finishedAt: new Date().toISOString(), artifacts: event.artifacts } : activity) }));
        return;
      }
      if (event.type === 'approval_required') {
        if (approvalCloseTimerRef.current !== null) window.clearTimeout(approvalCloseTimerRef.current);
        setApprovalClosing(false);
        setPendingApproval(event);
        return;
      }
      if (event.type === 'approval_resolved') {
        if (pendingApproval?.approvalId === event.approvalId) dismissApproval();
        return;
      }
      setActiveRun((run) => (!run || run.id !== event.runId || run.conversationId !== event.conversationId || event.type === 'delta' ? run : null));
      if (event.type === 'delta') {
        setMessages((current) => {
          const existing = current[event.conversationId] ?? [];
          const index = existing.findIndex((message) => message.id === event.messageId);
          if (index < 0) return { ...current, [event.conversationId]: [...existing, { id: event.messageId, role: 'assistant', content: event.delta, time: '刚刚', createdAt: event.createdAt }] };
          const next = [...existing]; next[index] = { ...next[index], content: `${next[index].content}${event.delta}` };
          return { ...current, [event.conversationId]: next };
        });
      } else if (event.type === 'failed') {
        if (pendingApproval?.runId === event.runId) dismissApproval();
        setToolActivities((current) => ({ ...current, [event.conversationId]: (current[event.conversationId] ?? []).map((activity) => activity.status === 'running' ? { ...activity, status: 'failed' } : activity) }));
        setError(event.error);
      } else if (event.type === 'cancelled') {
        if (pendingApproval?.runId === event.runId) dismissApproval();
        setToolActivities((current) => ({ ...current, [event.conversationId]: (current[event.conversationId] ?? []).map((activity) => activity.status === 'running' ? { ...activity, status: 'cancelled' } : activity) }));
      }
      if (event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled') {
        void activeBridge.runs.list(event.conversationId).then((runs) => setConversationRuns((current) => ({ ...current, [event.conversationId]: runs })));
      }
    });
  }, [activeBridge, pendingApproval]);

  const activeTitle = useMemo(() => conversationItems.find((conversation) => conversation.id === activeConversation)?.title ?? '新会话', [activeConversation, conversationItems]);
  const activeProfile = AGENT_PROFILES.find((profile) => profile.id === activeProfileId) ?? AGENT_PROFILES[0];
  const activeProviderId = conversationItems.find((conversation) => conversation.id === activeConversation)?.providerId ?? newProviderId;
  const activeProvider = providers.find((item) => item.id === activeProviderId) ?? null;
  const isThinking = activeRun?.conversationId === activeConversation;
  const activeMessages = messages[activeConversation] ?? [];
  const activeActivities = toolActivities[activeConversation] ?? [];
  const latestCompletedRun = conversationRuns[activeConversation]?.find((run) => run.status === 'completed' && run.usage) ?? null;
  const latestUsage = latestCompletedRun?.usage ? { ...latestCompletedRun.usage, durationMs: Math.max(0, Date.parse(latestCompletedRun.finishedAt ?? latestCompletedRun.startedAt) - Date.parse(latestCompletedRun.startedAt)) } : null;
  const conversationIsEmpty = activeMessages.length === 0 && activeActivities.length === 0 && !isThinking && !interruptedRun;
  const releaseAttachments = (items: Attachment[]) => {
    if (items.length > 0 && activeBridge) void activeBridge.attachments.release(items.map((item) => item.id));
  };
  const selectConversation = (id: string) => { releaseAttachments(attachments); setError(null); setInterruptedRun(null); setAttachments([]); setComposerPrefill(null); setRequestedMessageId(null); setRequestedOpenTaskId(null); setActiveConversation(id); const conversation = conversationItems.find((item) => item.id === id); const projectId = conversation?.projectId; if (projectId) setActiveConversationProject(projectId); setActiveProfileId(conversation?.profileId ?? DEFAULT_AGENT_PROFILE_ID); const providerId = conversation?.providerId ?? providers[0]?.id; setProvider(providers.find((item) => item.id === providerId) ?? null); if (providerId) setNewProviderId(providerId); setActiveView('conversation'); };
  const selectConversationProvider = async (providerId: string) => {
    if (!activeBridge || !providerId || providerId === conversationItems.find((item) => item.id === activeConversation)?.providerId) return;
    try {
      const updated = await activeBridge.conversations.setProvider(activeConversation, providerId);
      setConversationItems((items) => items.map((item) => item.id === updated.id ? updated : item));
      setProvider(providers.find((item) => item.id === providerId) ?? provider);
      setNewProviderId(providerId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '切换会话 Provider 失败。'); }
  };
  const selectConversationProfile = async (profileId: AgentProfileId) => {
    if (!activeBridge || profileId === conversationItems.find((item) => item.id === activeConversation)?.profileId) return;
    const previousProfileId = activeProfileId;
    setActiveProfileId(profileId);
    try {
      await activeBridge.conversations.setProfile(activeConversation, profileId);
      setConversationItems((items) => items.map((item) => item.id === activeConversation ? { ...item, profileId } : item));
    } catch (reason) {
      setActiveProfileId(previousProfileId);
      setError(reason instanceof Error ? reason.message : '切换会话 Profile 失败。');
    }
  };
  const copyConversationId = async () => {
    try {
      await navigator.clipboard.writeText(activeConversation);
      setCopiedConversationId(true);
      window.setTimeout(() => setCopiedConversationId(false), 1600);
    } catch {
      setError('复制会话 ID 失败。');
    }
  };
  const refreshConversations = async () => {
    if (!activeBridge) return [];
    const items = await activeBridge.conversations.list(true);
    const sorted = sortConversations(items);
    setConversationItems(sorted);
    return sorted;
  };
  const createConversation = async (projectId = activeConversationProject, providerId = newProviderId, profileId = DEFAULT_AGENT_PROFILE_ID) => {
    closeSettings();
    setComposerPrefill(null);
    if (!activeBridge) return selectConversation('inbox');
    try { const created = await activeBridge.conversations.create(undefined, projectId, providerId || undefined, profileId); setConversationItems((items) => sortConversations([created, ...items])); setActiveConversation(created.id); setActiveConversationProject(created.projectId); setActiveProfileId(created.profileId); setProvider(providers.find((item) => item.id === created.providerId) ?? null); if (created.providerId) setNewProviderId(created.providerId); setActiveView('conversation'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '新建会话失败。'); }
  };
  const renameConversation = async (id: string, title: string): Promise<void> => {
    if (!activeBridge) return;
    const updated = await activeBridge.conversations.rename(id, title);
    setConversationItems((items) => items.map((item) => item.id === id ? updated : item));
  };
  const moveConversation = async (id: string, projectId: string): Promise<void> => {
    if (!activeBridge) return;
    const updated = await activeBridge.conversations.move(id, projectId);
    setConversationItems((items) => sortConversations(items.map((item) => item.id === id ? updated : item)));
    if (id === activeConversation) setActiveConversationProject(projectId);
  };
  const createConversationProject = async (name: string): Promise<void> => {
    if (!activeBridge) return;
    const created = await activeBridge.conversations.projects.create(name);
    setConversationProjects((projects) => [...projects, created].sort((left, right) => left.position - right.position));
    setActiveConversationProject(created.id);
  };
  const renameConversationProject = async (id: string, name: string): Promise<void> => {
    if (!activeBridge) return;
    const updated = await activeBridge.conversations.projects.rename(id, name);
    setConversationProjects((projects) => projects.map((project) => project.id === id ? updated : project));
  };
  const deleteConversationProject = async (id: string): Promise<void> => {
    if (!activeBridge) return;
    await activeBridge.conversations.projects.delete(id);
    const [projects, conversations] = await Promise.all([activeBridge.conversations.projects.list(), activeBridge.conversations.list(true)]);
    setConversationProjects(projects);
    setConversationItems(sortConversations(conversations));
    if (activeConversationProject === id) setActiveConversationProject('personal');
  };
  const archiveConversation = async (id: string, archived: boolean): Promise<void> => {
    if (!activeBridge) return;
    const updated = await activeBridge.conversations.archive(id, archived);
    const items = await refreshConversations();
    if (archived && id === activeConversation) {
      const next = items.find((item) => !item.archived);
      if (next) selectConversation(next.id);
      else await createConversation();
    } else setConversationItems((current) => current.map((item) => item.id === id ? updated : item));
  };
  const pinConversation = async (id: string, pinned: boolean): Promise<void> => {
    if (!activeBridge) return;
    const updated = await activeBridge.conversations.pin(id, pinned);
    setConversationItems((items) => sortConversations(items.map((item) => item.id === id ? updated : item)));
  };
  const deleteConversation = async (id: string): Promise<void> => {
    if (!activeBridge) return;
    await activeBridge.conversations.delete(id);
    const items = await refreshConversations();
    if (id === activeConversation) {
      const next = items.find((item) => !item.archived);
      if (next) selectConversation(next.id);
      else await createConversation();
    }
  };
  const pickAttachments = async () => {
    if (!activeBridge) return;
    try {
      const selected = await activeBridge.attachments.pick();
      setAttachments((current) => [...current, ...selected.filter((item) => !current.some((existing) => existing.id === item.id))]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '选择附件失败。'); }
  };
  const submitMessage = async (content: string, selectedAttachments: Attachment[] = [], reasoningLevel?: ReasoningLevel) => {
    setError(null);
    if (!activeBridge) { setMessages((current) => ({ ...current, [activeConversation]: [...(current[activeConversation] ?? []), { id: `user-${Date.now()}`, role: 'user', content, time: '刚刚' }] })); return; }
    if (!provider?.hasApiKey) { openSettings(); return; }
    try {
      const result = retryDraft
        ? await activeBridge.runs.retry(activeConversation, retryDraft.messageId, content, reasoningLevel)
        : await activeBridge.runs.start(activeConversation, content, selectedAttachments.map((attachment) => attachment.id), reasoningLevel);
      setConversationItems((items) => sortConversations(items.map((item) => item.id === result.conversation.id ? result.conversation : item)));
      setMessages((current) => {
        const existing = current[activeConversation] ?? [];
        const visible = retryDraft ? existing.slice(0, existing.findIndex((message) => message.id === retryDraft.messageId)) : existing;
        return { ...current, [activeConversation]: [...visible, { ...displayMessage(result.userMessage), attachments: selectedAttachments.map(({ id, name, size }) => ({ id, name, size })) }] };
      });
      if (retryDraft) {
        const messageIndex = activeMessages.findIndex((message) => message.id === retryDraft.messageId);
        const cutoff = messageIndex >= 0 ? Date.parse(activeMessages[messageIndex].createdAt ?? '') : Number.NEGATIVE_INFINITY;
        setToolActivities((current) => ({ ...current, [activeConversation]: (current[activeConversation] ?? []).filter((activity) => Date.parse(activity.startedAt ?? '') < cutoff) }));
      }
      setRetryDraft(null);
      setInterruptedRun(null);
      setAttachments((current) => current.filter((attachment) => !selectedAttachments.some((selected) => selected.id === attachment.id)));
    } catch (reason) { setError(reason instanceof Error ? reason.message : '启动运行失败。'); }
  };
  const retryLastTurn = async (edit = false, inputMessageId?: string) => {
    const lastUser = inputMessageId
      ? activeMessages.find((message) => message.id === inputMessageId && message.role === 'user')
      : [...activeMessages].reverse().find((message) => message.role === 'user');
    if (!lastUser || isThinking || retryingRunRef.current) return;
    if (edit) {
      setRetryDraft({ messageId: lastUser.id, content: lastUser.content });
      setComposerPrefill((current) => ({ id: (current?.id ?? 0) + 1, value: lastUser.content }));
      return;
    }
    retryingRunRef.current = true;
    setRetryingRun(true);
    setRetryDraft({ messageId: lastUser.id, content: lastUser.content });
    try {
      const result = await activeBridge?.runs.retry(activeConversation, lastUser.id, lastUser.content, reasoningSelection === 'default' ? undefined : reasoningSelection);
      if (!result) return;
      const index = activeMessages.findIndex((message) => message.id === lastUser.id);
      setMessages((current) => ({ ...current, [activeConversation]: [...(current[activeConversation] ?? []).slice(0, index), displayMessage(result.userMessage)] }));
      const cutoff = index >= 0 ? Date.parse(activeMessages[index].createdAt ?? '') : Number.NEGATIVE_INFINITY;
      setToolActivities((current) => ({ ...current, [activeConversation]: (current[activeConversation] ?? []).filter((activity) => Date.parse(activity.startedAt ?? '') < cutoff) }));
      setRetryDraft(null);
      setInterruptedRun(null);
    } catch (reason) { setRetryDraft(null); setError(reason instanceof Error ? reason.message : '重新生成失败。'); }
    finally { retryingRunRef.current = false; setRetryingRun(false); }
  };
  const cancelRun = () => { if (activeRun && activeBridge) void activeBridge.runs.cancel(activeRun.id); };
  const resolveApproval = async (approved: boolean) => {
    const approval = pendingApproval;
    if (!approval || !activeBridge) return;
    dismissApproval();
    try { await activeBridge.runs.approve(approval.approvalId, approved); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '提交浏览器授权失败。'); }
  };
  const removeAttachment = (id: string) => {
    const removed = attachments.find((attachment) => attachment.id === id);
    if (removed) releaseAttachments([removed]);
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  };
  const interruptedMessage = interruptedRun?.inputMessageId ? (messages[activeConversation] ?? []).find((message) => message.id === interruptedRun.inputMessageId)?.content : null;
  const createTask = async (input: CreateTaskInput): Promise<Task> => {
    if (!activeBridge || !activeTaskBoardId) throw new Error('任务存储仅在桌面应用中可用。');
    const task = await activeBridge.tasks.create(activeTaskBoardId, input);
    setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
    return task;
  };
  const updateTask = async (id: string, patch: UpdateTaskInput): Promise<Task> => {
    if (!activeBridge) throw new Error('任务存储仅在桌面应用中可用。');
    const task = await activeBridge.tasks.update(id, patch);
    setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
    return task;
  };
  const deleteTask = async (id: string): Promise<void> => {
    if (!activeBridge) throw new Error('任务存储仅在桌面应用中可用。');
    await activeBridge.tasks.delete(id);
    setTasks((current) => current.filter((task) => task.id !== id));
    setTodayTasks((current) => current.filter((item) => item.task.id !== id));
  };
  const reorderTask = async (id: string, targetId: string): Promise<void> => {
    if (!activeBridge) throw new Error('任务存储仅在桌面应用中可用。');
    const reordered = await activeBridge.tasks.reorder(id, targetId);
    setTasks((current) => {
      const ids = new Set(reordered.map((task) => task.id));
      return [...reordered, ...current.filter((task) => !ids.has(task.id))];
    });
  };
  const moveTaskToBoard = async (id: string, boardId: string): Promise<Task> => {
    if (!activeBridge) throw new Error('任务存储仅在桌面应用中可用。');
    const existing = tasks.find((item) => item.id === id);
    if (existing?.boardId === boardId) return existing;
    const task = await activeBridge.tasks.moveToBoard(id, boardId);
    setTasks((current) => current.filter((item) => item.id !== id));
    return task;
  };
  const copyTaskToBoard = async (id: string, boardId: string): Promise<Task> => {
    if (!activeBridge) throw new Error('任务存储仅在桌面应用中可用。');
    return activeBridge.tasks.copyToBoard(id, boardId);
  };
  const createTaskType = async (name: string): Promise<TaskType> => {
    if (!activeBridge || !activeTaskBoardId) throw new Error('任务存储仅在桌面应用中可用。');
    const taskType = await activeBridge.tasks.types.create(activeTaskBoardId, name);
    setTaskTypes((current) => [...current, taskType].sort((left, right) => left.position - right.position));
    return taskType;
  };
  const renameTaskType = async (id: string, name: string): Promise<TaskType> => {
    if (!activeBridge) throw new Error('任务存储仅在桌面应用中可用。');
    const taskType = await activeBridge.tasks.types.rename(id, name);
    setTaskTypes((current) => current.map((item) => item.id === id ? taskType : item));
    return taskType;
  };
  const deleteTaskType = async (id: string): Promise<void> => {
    if (!activeBridge) throw new Error('任务存储仅在桌面应用中可用。');
    await activeBridge.tasks.types.delete(id);
    setTaskTypes((current) => current.filter((item) => item.id !== id));
  };
  const createTaskBoard = async (name: string): Promise<void> => {
    if (!activeBridge) throw new Error('任务看板仅在桌面应用中可用。');
    const board = await activeBridge.tasks.boards.create(name);
    setTaskBoards((current) => [...current.filter((item) => item.id !== board.id), board].sort((left, right) => left.position - right.position));
    setActiveTaskBoardId(board.id);
    closeSettings();
    setActiveView('tasks');
  };
  const renameTaskBoard = async (id: string, name: string): Promise<void> => {
    if (!activeBridge) throw new Error('任务看板仅在桌面应用中可用。');
    const board = await activeBridge.tasks.boards.rename(id, name);
    setTaskBoards((current) => current.map((item) => item.id === id ? board : item));
  };
  const reorderTaskBoard = async (id: string, targetId: string): Promise<void> => {
    if (!activeBridge) throw new Error('任务看板仅在桌面应用中可用。');
    const boards = await activeBridge.tasks.boards.reorder(id, targetId);
    setTaskBoards(boards);
  };
  const deleteTaskBoard = async (id: string): Promise<void> => {
    if (!activeBridge) throw new Error('任务看板仅在桌面应用中可用。');
    await activeBridge.tasks.boards.delete(id);
    const boards = await activeBridge.tasks.boards.list();
    setTaskBoards(boards);
    setActiveTaskBoardId((current) => current === id ? (boards[0]?.id ?? '') : current);
  };
  const importTaskAsset = async (file: File): Promise<TaskAsset> => {
    if (!activeBridge) throw new Error('附件仅在桌面应用中可用。');
    return activeBridge.tasks.assets.import({ name: file.name || '粘贴的图片.png', mimeType: file.type || 'application/octet-stream', data: await file.arrayBuffer() });
  };
  const pickTaskAssets = async (): Promise<TaskAsset[]> => {
    if (!activeBridge) throw new Error('附件仅在桌面应用中可用。');
    return activeBridge.tasks.assets.pick();
  };
  const openTaskAsset = async (url: string): Promise<void> => {
    if (!activeBridge) throw new Error('附件仅在桌面应用中可用。');
    await activeBridge.tasks.assets.open(url);
  };
  const openSearchResult = (result: SearchResult) => {
    closeSettings();
    if (result.kind === 'conversation') {
      selectConversation(result.id);
      return;
    }
    if (result.kind === 'message' && result.parentId) {
      selectConversation(result.parentId);
      setRequestedMessageId(result.id);
      return;
    }
    setRequestedMessageId(null);
    setActiveView('tasks');
    if (result.kind === 'task' && result.parentId) {
      setActiveTaskBoardId(result.parentId);
      setRequestedOpenTaskId(result.id);
    } else if (result.kind === 'board') {
      setActiveTaskBoardId(result.id);
      setRequestedOpenTaskId(null);
    }
  };
  const exportActiveConversation = async () => {
    if (!activeBridge) return;
    try {
      const savedPath = await activeBridge.conversations.export(activeConversation);
      if (savedPath) setError(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '导出会话失败。'); }
  };
  const importConversation = async () => {
    if (!activeBridge) return;
    try {
      const imported = await activeBridge.conversations.import();
      if (!imported) return;
      const [items, importedMessages, importedRuns] = await Promise.all([activeBridge.conversations.list(true), activeBridge.conversations.messages(imported.id), activeBridge.runs.list(imported.id)]);
      setConversationItems(sortConversations(items));
      setActiveConversation(imported.id); setActiveConversationProject(imported.projectId); setActiveProfileId(imported.profileId); setProvider(providers.find((item) => item.id === imported.providerId) ?? provider);
      setMessages((current) => ({ ...current, [imported.id]: importedMessages.map(displayMessage) }));
      setConversationRuns((current) => ({ ...current, [imported.id]: importedRuns }));
      setToolActivities((current) => ({ ...current, [imported.id]: importedRuns.flatMap((run) => run.activities).map((activity) => ({ id: activity.id, toolName: activity.toolName, status: activity.status, input: activity.input ?? undefined, output: activity.output ?? undefined, startedAt: activity.startedAt, finishedAt: activity.finishedAt, artifacts: activity.artifacts })) }));
      setInterruptedRun(null); setActiveView('conversation'); closeSettings();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '导入会话失败。'); }
  };

  return <main className={`app-shell ${sidebarCollapsed ? 'sidebar-is-collapsed' : ''} ${contextCollapsed || settingsMounted ? 'context-is-collapsed' : ''} ${activeView === 'tasks' ? 'tasks-is-active' : ''} ${settingsMounted ? 'settings-is-active' : ''} ${settingsClosing ? 'settings-is-closing' : ''} ${profileMenuClosing || providerMenuClosing ? 'header-menu-closing' : ''}`}>
    <Sidebar conversations={conversationItems} projects={conversationProjects} boards={taskBoards} providers={providers} newProviderId={newProviderId} activeId={activeConversation} activeProjectId={activeConversationProject} activeBoardId={activeTaskBoardId} mode={activeView} settingsOpen={providerOpen} collapsed={sidebarCollapsed} appVersion={appInfo?.version} onSearch={() => setSearchOpen(true)} onSelect={(id) => { closeSettings(); selectConversation(id); }} onSelectProject={setActiveConversationProject} onSelectBoard={(id) => { closeSettings(); setRequestedOpenTaskId(null); setActiveTaskBoardId(id); setActiveView('tasks'); }} onModeChange={(mode) => { releaseAttachments(attachments); setAttachments([]); setError(null); setRequestedMessageId(null); setRequestedOpenTaskId(null); closeSettings(); setActiveView(mode); }} onNew={(projectId, providerId) => void createConversation(projectId, providerId)} onNewProviderChange={setNewProviderId} onRenameConversation={renameConversation} onMoveConversation={moveConversation} onArchiveConversation={archiveConversation} onPinConversation={pinConversation} onDeleteConversation={deleteConversation} onCreateProject={createConversationProject} onRenameProject={renameConversationProject} onDeleteProject={deleteConversationProject} onCreateBoard={createTaskBoard} onRenameBoard={renameTaskBoard} onDeleteBoard={deleteTaskBoard} onReorderBoard={reorderTaskBoard} onMoveTaskToBoard={async (id, boardId) => { await moveTaskToBoard(id, boardId); }} onSettings={openSettings} onToggle={() => setSidebarCollapsed((current) => !current)} />
    <section className="workspace" aria-label="会话工作区">
      {settingsMounted ? <SettingsWorkspace appInfo={appInfo} current={provider} providers={providers} browserUseConfig={browserUseConfig} computerUseConfig={computerUseConfig} theme={theme} onThemeChange={setTheme} onClose={closeSettings} onSaved={(saved) => { const boundProviderId = conversationItems.find((item) => item.id === activeConversation)?.providerId; if (!boundProviderId || boundProviderId === saved.id) setProvider(saved); }} onProvidersChange={setProviders} onBrowserUseChange={setBrowserUseConfig} onComputerUseChange={setComputerUseConfig} /> : activeView === 'tasks' ? <Suspense fallback={<div className="task-page-loading">正在打开任务看板...</div>}><TaskBoard boardId={activeTaskBoardId} boardName={taskBoards.find((board) => board.id === activeTaskBoardId)?.name ?? '任务'} boards={taskBoards} tasks={tasks} taskTypes={taskTypes} loading={tasksLoading} headerControl={sidebarCollapsed ? <SidebarExpandControl onExpand={() => setSidebarCollapsed(false)} /> : null} requestedOpenTaskId={requestedOpenTaskId} onOpenTaskHandled={() => setRequestedOpenTaskId(null)} sourceConversations={conversationItems} onOpenConversation={selectConversation} onCreate={createTask} onUpdate={updateTask} onDelete={deleteTask} onReorder={reorderTask} onMoveToBoard={moveTaskToBoard} onCopyToBoard={copyTaskToBoard} onCreateType={createTaskType} onRenameType={renameTaskType} onDeleteType={deleteTaskType} onImportAsset={importTaskAsset} onPickAssets={pickTaskAssets} onOpenAsset={openTaskAsset} /></Suspense> : <>
      <header className="workspace-header">{sidebarCollapsed && <SidebarExpandControl onExpand={() => setSidebarCollapsed(false)} />}<div className="conversation-identity"><div className="identity-mark"><ThinkingOrb state={isThinking ? 'working' : 'breathing'} size={20} theme="dark" /></div><div><h1>{activeTitle}</h1><span className="identity-meta">个人工作区 <span className="meta-separator">·</span> 会话 ID <button type="button" className="conversation-id-button" onClick={() => void copyConversationId()} title={`复制完整会话 ID：${activeConversation}`} aria-label={`复制会话 ID：${activeConversation}`}>{copiedConversationId ? '已复制' : shortId(activeConversation)}</button><span className="meta-separator">·</span><span className="conversation-profile-picker"><span>Profile</span><span className="profile-picker-control"><button type="button" className="profile-picker-trigger" aria-haspopup="listbox" aria-expanded={profileMenuOpen} aria-label={`当前会话 Profile：${activeProfile.name}`} title={activeProfile.description} onClick={() => setProfileMenuOpen((current) => !current)}><span>{activeProfile.name}</span><ChevronDown size={13} aria-hidden="true" /></button>{profileMenuOpen && <span className="profile-picker-menu" role="listbox" aria-label="选择会话 Profile">{AGENT_PROFILES.map((item) => <button type="button" role="option" aria-selected={item.id === activeProfileId} className={item.id === activeProfileId ? 'is-selected' : ''} key={item.id} onClick={() => { setProfileMenuOpen(false); void selectConversationProfile(item.id); }}><span><strong>{item.name}</strong><small>{item.description}</small></span>{item.id === activeProfileId && <span className="profile-picker-check" aria-hidden="true">✓</span>}</button>)}</span>}</span></span>{providers.length > 0 && <><span className="meta-separator">·</span><span className="conversation-provider-picker"><span>Provider</span><span className="provider-picker-control"><button type="button" className="provider-picker-trigger" aria-haspopup="listbox" aria-expanded={providerMenuOpen} aria-label={`当前会话 Provider：${activeProvider?.displayName ?? '未选择'}`} title={activeProvider ? `${activeProvider.displayName} · ${activeProvider.model}` : '选择 Provider'} onClick={() => setProviderMenuOpen((current) => !current)}><span>{(activeProvider?.displayName ?? activeProviderId) || '未选择'}</span><ChevronDown size={13} aria-hidden="true" /></button>{providerMenuOpen && <span className="provider-picker-menu" role="listbox" aria-label="选择会话 Provider">{providers.map((item) => <button type="button" role="option" aria-selected={item.id === activeProviderId} className={`${item.id === activeProviderId ? 'is-selected' : ''} ${item.hasApiKey ? '' : 'is-disabled'}`} key={item.id} disabled={!item.hasApiKey} onClick={() => { setProviderMenuOpen(false); void selectConversationProvider(item.id); }}><span><strong>{item.displayName}</strong><small>{item.protocol} · {item.model}{item.hasApiKey ? '' : ' · 未配置 Key'}</small></span>{item.id === activeProviderId && <span className="profile-picker-check" aria-hidden="true">✓</span>}</button>)}</span>}</span></span></>}</span></div></div><div className="header-actions"><button type="button" className="header-icon-button" onClick={() => void importConversation()} aria-label="导入会话" title="导入会话"><Upload size={15} /></button><button type="button" className="header-icon-button" onClick={() => void exportActiveConversation()} aria-label="导出会话" title="导出会话"><Download size={15} /></button><ContextWindowStatus usage={latestCompletedRun?.usage ?? null} refreshing={Boolean(isThinking)} /><div className="header-status" aria-live="polite"><span className={`status-dot ${isThinking ? 'is-active' : ''}`} />{isThinking ? '处理中' : error ? '需要处理' : '就绪'}</div><button type="button" className="header-button" onClick={() => setContextCollapsed((current) => !current)} aria-label={contextCollapsed ? '打开详情面板' : '关闭详情面板'}>{contextCollapsed ? '详情' : '收起'}</button></div></header>
      {error && <div className="inline-error" role="alert">{error}<button type="button" onClick={() => setError(null)} aria-label="关闭错误提示">×</button></div>}
      <div className={`conversation-body ${conversationIsEmpty ? 'is-empty' : ''}`}>
        {conversationIsEmpty ? <ConversationStart composer={<Composer variant="start" prefill={composerPrefill} busy={Boolean(isThinking)} attachments={attachments} reasoningSelection={reasoningSelection} onReasoningSelectionChange={(selection) => { setReasoningSelection(selection); void activeBridge?.reasoning.save(activeConversation, selection); }} onAttach={pickAttachments} onRemoveAttachment={removeAttachment} onSubmit={submitMessage} onCancel={cancelRun} />} onSelectPrompt={(value) => setComposerPrefill((current) => ({ id: (current?.id ?? 0) + 1, value }))} /> : <>
          <Transcript messages={activeMessages} isThinking={isThinking} activities={activeActivities} runs={conversationRuns[activeConversation] ?? []} latestUsage={latestUsage} recoveryNotice={interruptedRun ? { message: interruptedRun.error ?? '应用重启时运行被中断。', onRetry: interruptedMessage ? () => void retryLastTurn(false, interruptedRun.inputMessageId ?? undefined) : undefined, busy: retryingRun } : null} requestedMessageId={requestedMessageId} onRequestedMessageHandled={() => setRequestedMessageId(null)} onEditLastUser={(message) => { setRetryDraft({ messageId: message.id, content: message.content }); setComposerPrefill((current) => ({ id: (current?.id ?? 0) + 1, value: message.content })); }} onRegenerate={() => void retryLastTurn()} onOpenTask={(boardId, taskId) => { closeSettings(); setActiveTaskBoardId(boardId); setActiveView('tasks'); setRequestedOpenTaskId(taskId); }} />
          <Composer editing={Boolean(retryDraft)} prefill={composerPrefill} onCancelEdit={() => { setRetryDraft(null); setComposerPrefill(null); }} busy={Boolean(isThinking) || retryingRun} attachments={attachments} reasoningSelection={reasoningSelection} onReasoningSelectionChange={(selection) => { setReasoningSelection(selection); void activeBridge?.reasoning.save(activeConversation, selection); }} onAttach={pickAttachments} onRemoveAttachment={removeAttachment} onSubmit={submitMessage} onCancel={cancelRun} />
        </>}
      </div>
      </>}
    </section>
    {activeView === 'conversation' && <aside className="context-panel" aria-label="今日概览" aria-hidden={contextCollapsed}><div className="panel-heading"><div><span>今日概览</span><small>{todayTasks.length > 0 ? `${todayTasks.length} 项需要关注` : '暂无需要关注的任务'}</small></div><button type="button" className="icon-button" onClick={() => setContextCollapsed(true)} aria-label="关闭详情面板">×</button></div><div className="activity-card"><div className="activity-icon"><ThinkingOrb state={isThinking ? 'working' : 'breathing'} size={20} theme="dark" /></div><div><strong>{isThinking ? '正在整理请求' : todayTasks.length > 0 ? '今天有待处理事项' : '安排得很轻松'}</strong><p>{isThinking ? '完成后会在这里显示结果。' : todayTasks.length > 0 ? '优先处理逾期和今天到期的任务。' : '确认后的待办会出现在这里。'}</p></div></div><div className="panel-section"><div className="section-heading"><span className="section-label">待办</span><button type="button" className="text-button" onClick={() => setActiveView('tasks')}>查看全部</button></div>{todayTasks.length === 0 ? <div className="empty-state"><span className="empty-state-icon">✓</span><p>今天还没有待办</p><small>确认后的事项会显示在这里</small></div> : <div className="today-task-list">{todayTasks.map(({ task, kind }) => <button type="button" className={`today-task today-task-${kind}`} key={task.id} onClick={() => { setActiveTaskBoardId(task.boardId); setActiveView('tasks'); setRequestedOpenTaskId(task.id); }}><span className="today-task-icon">{kind === 'overdue' ? <AlertCircle size={14} /> : kind === 'due_today' ? <CalendarCheck2 size={14} /> : <CalendarClock size={14} />}</span><span className="today-task-copy"><strong>{task.title}</strong><small>{todayTaskKindLabel(kind)}{task.priority === 'high' ? ' · 高优先级' : ''}</small></span></button>)}</div>}</div></aside>}
    {searchOpen && <GlobalSearch onQuery={(query) => activeBridge?.search.query(query) ?? Promise.resolve([])} onOpen={openSearchResult} onClose={() => setSearchOpen(false)} />}
    {pendingApproval && <div className={`approval-backdrop ${approvalClosing ? 'is-closing' : ''}`} role="presentation"><section className="approval-dialog" role="alertdialog" aria-modal="true" aria-labelledby="approval-title" aria-describedby="approval-description"><div className="approval-dialog-header"><span>Agent Runtime</span><h2 id="approval-title">允许这次工具操作？</h2><p id="approval-description">玉衡准备执行 <code>{pendingApproval.toolName}</code></p></div>{pendingApproval.input && <pre>{pendingApproval.input}</pre>}<div className="approval-actions"><button type="button" className="secondary-action" onClick={() => void resolveApproval(false)} disabled={approvalClosing}>拒绝</button><button type="button" className="send-button" autoFocus onClick={() => void resolveApproval(true)} disabled={approvalClosing}>允许一次</button></div></section></div>}
  </main>;
}
