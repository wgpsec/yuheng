import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ThinkingOrb } from 'thinking-orbs';
import { Composer } from '../features/conversation/workspace/composer';
import { Sidebar, type Conversation as SidebarConversation } from '../features/conversation/workspace/sidebar';
import { Transcript, type TranscriptMessage } from '../features/conversation/workspace/transcript';
import type { Attachment, DesktopBridge, Message, ProviderConfig, ProviderProtocol, RunEvent, RunSummary } from '../contracts/desktop-bridge';

type ThemeName = 'dark' | 'light' | 'graphite';

const fallbackConversations: SidebarConversation[] = [
  { id: 'inbox', title: '收件箱', time: '现在' },
  { id: 'weekly-plan', title: '本周计划', time: '昨天' },
  { id: 'research', title: '资料整理', time: '周一' },
];
const fallbackMessages: Record<string, TranscriptMessage[]> = {
  inbox: [],
  'weekly-plan': [{ id: 'weekly-1', role: 'user', content: '帮我整理一下本周最重要的三件事。', time: '昨天 18:42' }, { id: 'weekly-2', role: 'assistant', content: '可以。先从已经确认的事项开始：项目发布、供应商跟进和周五的复盘。', time: '昨天 18:43' }],
  research: [{ id: 'research-1', role: 'user', content: '把上次收集的资料按主题分一下。', time: '周一 10:16' }, { id: 'research-2', role: 'assistant', content: '我先按“产品、技术、待确认”三个主题归类，待确认的内容单独列出。', time: '周一 10:17' }],
};

const getBridge = (): DesktopBridge | undefined => (typeof window !== 'undefined' ? window.desktopBridge : undefined);
function displayMessage(message: Message): TranscriptMessage {
  return { ...message, time: new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) };
}

function ProviderSettings({ current, theme, onThemeChange, onClose, onSaved }: { current: ProviderConfig | null; theme: ThemeName; onThemeChange: (theme: ThemeName) => void; onClose: () => void; onSaved: (provider: ProviderConfig) => void }) {
  const [protocol, setProtocol] = useState<ProviderProtocol>(current?.protocol ?? 'openai');
  const [baseUrl, setBaseUrl] = useState(current?.baseUrl ?? 'https://api.openai.com/v1');
  const [model, setModel] = useState(current?.model ?? 'gpt-4o-mini');
  const [displayName, setDisplayName] = useState(current?.displayName ?? '默认模型');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const activeBridge = getBridge();
    if (!activeBridge) return;
    setError(null);
    try {
      const saved = await activeBridge.provider.save({ protocol, baseUrl, model, displayName, apiKey });
      setApiKey('');
      onSaved(saved);
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败。'); }
  };
  return <section className="settings-page" aria-labelledby="provider-title">
      <div className="settings-page-header"><div><button type="button" className="back-button" onClick={onClose}>‹ 返回会话</button><h2 id="provider-title">设置</h2><p>管理玉衡使用的模型服务。密钥仅保存在这台 Mac 的钥匙串中。</p></div></div>
      <div className="settings-section"><div className="settings-section-heading"><div><h3>语言模型</h3><p>配置一个用于本地会话的 Provider。</p></div><span className={`settings-state ${current?.hasApiKey ? 'is-ready' : ''}`}>{current?.hasApiKey ? '已配置' : '未配置'}</span></div>
      <form onSubmit={save}>
        <label>协议<select value={protocol} onChange={(event) => setProtocol(event.target.value as ProviderProtocol)}><option value="openai">OpenAI-compatible</option><option value="anthropic">Anthropic Messages</option></select></label>
        <label>显示名称<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label>
        <label>Base URL<input type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required /></label>
        <label>模型<input value={model} onChange={(event) => setModel(event.target.value)} required /></label>
        <label>API Key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={current?.hasApiKey ? '已配置，留空则保持不变' : '输入 API Key'} autoComplete="off" /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="provider-modal-actions"><button type="button" className="secondary-action" onClick={onClose}>取消</button><button type="submit" className="send-button">保存配置</button></div>
      </form>
      </div>
      <div className="settings-section appearance-section"><div className="settings-section-heading"><div><h3>界面外观</h3><p>选择玉衡工作区的基础配色。</p></div></div><div className="theme-options" role="radiogroup" aria-label="界面配色"><button type="button" className={`theme-option ${theme === 'dark' ? 'is-selected' : ''}`} onClick={() => onThemeChange('dark')} role="radio" aria-checked={theme === 'dark'}><span className="theme-swatch theme-swatch-dark" /><span><strong>深色</strong><small>适合长时间专注</small></span></button><button type="button" className={`theme-option ${theme === 'light' ? 'is-selected' : ''}`} onClick={() => onThemeChange('light')} role="radio" aria-checked={theme === 'light'}><span className="theme-swatch theme-swatch-light" /><span><strong>浅色</strong><small>明亮清晰</small></span></button><button type="button" className={`theme-option ${theme === 'graphite' ? 'is-selected' : ''}`} onClick={() => onThemeChange('graphite')} role="radio" aria-checked={theme === 'graphite'}><span className="theme-swatch theme-swatch-graphite" /><span><strong>石墨灰</strong><small>低对比度</small></span></button></div></div>
    </section>;
}

export function ProductionRenderer() {
  const activeBridge = getBridge();
  const [conversationItems, setConversationItems] = useState<SidebarConversation[]>(fallbackConversations);
  const [activeConversation, setActiveConversation] = useState('inbox');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const [messages, setMessages] = useState<Record<string, TranscriptMessage[]>>(fallbackMessages);
  const [activeRun, setActiveRun] = useState<{ id: string; conversationId: string } | null>(null);
  const [provider, setProvider] = useState<ProviderConfig | null>(null);
  const [providerOpen, setProviderOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeName>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('yuheng-theme') : null;
    return saved === 'light' || saved === 'graphite' ? saved : 'dark';
  });
  const [error, setError] = useState<string | null>(null);
  const [interruptedRun, setInterruptedRun] = useState<RunSummary | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('yuheng-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!activeBridge) return;
    let mounted = true;
    void Promise.all([activeBridge.conversations.list(), activeBridge.provider.get()]).then(([items, configuredProvider]) => {
      if (!mounted) return;
      setConversationItems(items);
      setProvider(configuredProvider);
      if (items[0]) setActiveConversation(items[0].id);
    }).catch((reason) => { if (mounted) setError(reason instanceof Error ? reason.message : '加载本地数据失败。'); });
    return () => { mounted = false; };
  }, [activeBridge]);

  useEffect(() => {
    if (!activeBridge) return;
    let mounted = true;
    void Promise.all([activeBridge.conversations.messages(activeConversation), activeBridge.runs.list(activeConversation)]).then(([items, runs]) => {
      if (!mounted) return;
      setMessages((current) => ({ ...current, [activeConversation]: items.map(displayMessage) }));
      setInterruptedRun(runs.find((run) => run.status === 'interrupted') ?? null);
    }).catch((reason) => { if (mounted) setError(reason instanceof Error ? reason.message : '加载会话失败。'); });
    return () => { mounted = false; };
  }, [activeBridge, activeConversation]);

  useEffect(() => {
    if (!activeBridge) return;
    return activeBridge.runs.onEvent((event: RunEvent) => {
      if (event.type === 'accepted') { setActiveRun({ id: event.runId, conversationId: event.conversationId }); return; }
      setActiveRun((run) => (!run || run.id !== event.runId || run.conversationId !== event.conversationId || event.type === 'delta' ? run : null));
      if (event.type === 'delta') {
        setMessages((current) => {
          const existing = current[event.conversationId] ?? [];
          const index = existing.findIndex((message) => message.id === event.messageId);
          if (index < 0) return { ...current, [event.conversationId]: [...existing, { id: event.messageId, role: 'assistant', content: event.delta, time: '刚刚' }] };
          const next = [...existing]; next[index] = { ...next[index], content: `${next[index].content}${event.delta}` };
          return { ...current, [event.conversationId]: next };
        });
      } else if (event.type === 'failed') setError(event.error);
    });
  }, [activeBridge]);

  const activeTitle = useMemo(() => conversationItems.find((conversation) => conversation.id === activeConversation)?.title ?? '新会话', [activeConversation, conversationItems]);
  const isThinking = activeRun?.conversationId === activeConversation;
  const releaseAttachments = (items: Attachment[]) => {
    if (items.length > 0 && activeBridge) void activeBridge.attachments.release(items.map((item) => item.id));
  };
  const selectConversation = (id: string) => { releaseAttachments(attachments); setError(null); setAttachments([]); setActiveConversation(id); };
  const createConversation = async () => {
    setProviderOpen(false);
    if (!activeBridge) return selectConversation('inbox');
    try { const created = await activeBridge.conversations.create(); setConversationItems((items) => [created, ...items]); setActiveConversation(created.id); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '新建会话失败。'); }
  };
  const pickAttachments = async () => {
    if (!activeBridge) return;
    try {
      const selected = await activeBridge.attachments.pick();
      setAttachments((current) => [...current, ...selected.filter((item) => !current.some((existing) => existing.id === item.id))]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '选择附件失败。'); }
  };
  const submitMessage = async (content: string, selectedAttachments: Attachment[] = []) => {
    setError(null);
    if (!activeBridge) { setMessages((current) => ({ ...current, [activeConversation]: [...(current[activeConversation] ?? []), { id: `user-${Date.now()}`, role: 'user', content, time: '刚刚' }] })); return; }
    if (!provider?.hasApiKey) { setProviderOpen(true); return; }
    try {
      const result = await activeBridge.runs.start(activeConversation, content, selectedAttachments.map((attachment) => attachment.id));
      setMessages((current) => ({ ...current, [activeConversation]: [...(current[activeConversation] ?? []), { ...displayMessage(result.userMessage), attachments: selectedAttachments.map(({ id, name, size }) => ({ id, name, size })) }] }));
      setInterruptedRun(null);
      setAttachments((current) => current.filter((attachment) => !selectedAttachments.some((selected) => selected.id === attachment.id)));
    } catch (reason) { setError(reason instanceof Error ? reason.message : '启动运行失败。'); }
  };
  const cancelRun = () => { if (activeRun && activeBridge) void activeBridge.runs.cancel(activeRun.id); };
  const removeAttachment = (id: string) => {
    const removed = attachments.find((attachment) => attachment.id === id);
    if (removed) releaseAttachments([removed]);
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  };
  const interruptedMessage = interruptedRun?.inputMessageId ? (messages[activeConversation] ?? []).find((message) => message.id === interruptedRun.inputMessageId)?.content : null;

  return <main className={`app-shell ${sidebarCollapsed ? 'sidebar-is-collapsed' : ''} ${contextCollapsed || providerOpen ? 'context-is-collapsed' : ''}`}>
    <Sidebar conversations={conversationItems} activeId={activeConversation} collapsed={sidebarCollapsed} onSelect={(id) => { setProviderOpen(false); selectConversation(id); }} onNew={() => void createConversation()} onSettings={() => setProviderOpen(true)} onToggle={() => setSidebarCollapsed((current) => !current)} />
    <section className="workspace" aria-label="会话工作区">
      {providerOpen ? <ProviderSettings current={provider} theme={theme} onThemeChange={setTheme} onClose={() => setProviderOpen(false)} onSaved={setProvider} /> : <>
      <header className="workspace-header"><div className="conversation-identity"><div className="identity-mark"><ThinkingOrb state={isThinking ? 'working' : 'breathing'} size={20} theme="dark" /></div><div><h1>{activeTitle}</h1><span className="identity-meta">个人工作区 <span className="meta-separator">·</span> 本地保存</span></div></div><div className="header-actions"><div className="header-status" aria-live="polite"><span className={`status-dot ${isThinking ? 'is-active' : ''}`} />{isThinking ? '处理中' : error ? '需要处理' : '就绪'}</div><button type="button" className="header-button" onClick={() => setContextCollapsed((current) => !current)} aria-label={contextCollapsed ? '打开详情面板' : '关闭详情面板'}>{contextCollapsed ? '详情' : '收起'}</button></div></header>
      {error && <div className="inline-error" role="alert">{error}<button type="button" onClick={() => setError(null)} aria-label="关闭错误提示">×</button></div>}
      <Transcript messages={messages[activeConversation] ?? []} isThinking={isThinking} recoveryNotice={interruptedRun && interruptedMessage ? { message: interruptedRun.error ?? '应用重启时运行被中断。', onRetry: () => void submitMessage(interruptedMessage) } : null} />
      <Composer busy={Boolean(isThinking)} attachments={attachments} onAttach={pickAttachments} onRemoveAttachment={removeAttachment} onSubmit={submitMessage} onCancel={cancelRun} />
      </>}
    </section>
    <aside className="context-panel" aria-label="今日概览" aria-hidden={contextCollapsed}><div className="panel-heading"><div><span>今日概览</span><small>同步于刚刚</small></div><button type="button" className="icon-button" onClick={() => setContextCollapsed(true)} aria-label="关闭详情面板">×</button></div><div className="activity-card"><div className="activity-icon"><ThinkingOrb state={isThinking ? 'working' : 'breathing'} size={20} theme="dark" /></div><div><strong>{isThinking ? '正在整理请求' : '暂无进行中的任务'}</strong><p>{isThinking ? '完成后会在这里显示结果。' : '确认后的待办会出现在这里。'}</p></div></div><div className="panel-section"><div className="section-heading"><span className="section-label">待办</span><button type="button" className="text-button">查看全部</button></div><div className="empty-state"><span className="empty-state-icon">✓</span><p>今天还没有待办</p><small>确认后的事项会显示在这里</small></div></div></aside>
  </main>;
}
