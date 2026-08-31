import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ArchiveRestore, ArrowLeft, Bell, BrainCircuit, Check, ChevronDown, Download, ExternalLink, FolderOpen, Info, KeyRound, ListTodo, MapPin, MessageSquare, NotebookPen, Palette, PanelLeftOpen, PawPrint, Play, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Composer } from '../features/conversation/workspace/composer';
import { ConversationStart } from '../features/conversation/workspace/conversation-start';
import { Sidebar, type Conversation as SidebarConversation } from '../features/conversation/workspace/sidebar';
import { Transcript, type ToolActivity, type TranscriptMessage } from '../features/conversation/workspace/transcript';
import { GlobalSearch } from '../features/search/global-search';
import { AGENT_PROFILES, DEFAULT_AGENT_PROFILE_ID, type AgentProfileId, type AppInfo, type Attachment, type BrowserUseConfig, type ComputerUseConfig, type ConversationProject, type CreateTaskInput, type DesktopBridge, type DesktopPetConfig, type CodexPetCatalogEntry, type CodexPetManifest, type Message, type PetOpenTarget, type PetState, type ProviderConfig, type ProviderProtocol, type ProviderTestResult, type ReasoningLevel, type ReasoningSelection, type RunEvent, type RunSummary, type SearchResult, type Task, type TaskAsset, type TaskBoard, type TaskEvent, type TaskType, type ToolPermissionMode, type UpdateTaskInput } from '../contracts/desktop-bridge';
import { releaseNotes } from '../features/settings/releases';
import { taskDraftFromMessage } from '../features/tasks/task-from-message';
import { buildNoteAiPrompt, type NoteAiAction } from '../features/notes/note-ai';
import { buildContextAiPrompt, buildBoardAiContext } from '../features/ai/context-ai';
import { taskDraftFromNote } from '../features/notes/task-from-note';
import { normalizeSettingsSection, type SettingsSection } from './settings-section';
import { clampSidebarWidth, DEFAULT_SIDEBAR_WIDTH, loadSidebarWidth, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, SIDEBAR_WIDTH_STORAGE_KEY } from './sidebar-preferences';
import { animationForState, nextCodexPetFrame } from './pet-animation';
import { useTaskWorkspace } from '../features/tasks/use-task-workspace';
import { useNoteWorkspace } from '../features/notes/use-note-workspace';
import { useSettingsController, type ThemeName } from '../features/settings/use-settings-controller';
import { useConversationWorkspace } from '../features/conversation/use-conversation-workspace';
const NotesWorkspace = lazy(() => import('../features/notes/notes-workspace').then((module) => ({ default: module.NotesWorkspace })));

type WorkspaceTab = { id: string; type: 'conversation' | 'tasks' | 'notes'; resourceId: string };

const readStoredWorkspaceTabs = (): WorkspaceTab[] => {
  if (typeof localStorage === 'undefined') return [{ id: 'conversation:inbox', type: 'conversation', resourceId: 'inbox' }];
  try {
    const parsed = JSON.parse(localStorage.getItem('yuheng-workspace-tabs') ?? '[]') as unknown;
    if (!Array.isArray(parsed)) throw new Error('invalid tabs');
    const tabs = parsed.filter((tab): tab is WorkspaceTab => Boolean(tab) && typeof tab === 'object' && (tab as WorkspaceTab).type && ['conversation', 'tasks', 'notes'].includes((tab as WorkspaceTab).type) && typeof (tab as WorkspaceTab).resourceId === 'string');
    return tabs.length ? tabs : [{ id: 'conversation:inbox', type: 'conversation', resourceId: 'inbox' }];
  } catch { return [{ id: 'conversation:inbox', type: 'conversation', resourceId: 'inbox' }]; }
};

const TaskBoard = lazy(() => import('../features/tasks/task-board').then((module) => ({ default: module.TaskBoard })));

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
    <button type="button" className="collapsed-sidebar-toggle" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onExpand(); }} aria-label="展开侧栏" title="展开侧栏"><PanelLeftOpen size={17} aria-hidden="true" /></button>
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

const PET_STATE_LABELS: Record<PetState, string> = { idle: '待机', thinking: '思考', working: '工作', attention: '提醒', error: '错误', celebrate: '完成' };

function isPetRuntimeUsable(entry: CodexPetCatalogEntry): boolean {
  return Boolean(entry.manifest && !entry.report.issues.some((issue) => issue.severity === 'error' && (issue.code === 'dimensions' || issue.code === 'blank_frames' || issue.code === 'manifest')));
}

function PetSkinPreview({ entry, asset }: { entry: CodexPetCatalogEntry; asset: { dataUrl: string; manifest: CodexPetManifest } }) {
  const [previewState, setPreviewState] = useState<PetState>('idle');
  const [frame, setFrame] = useState(0);
  const manifest = asset.manifest;
  const animation = animationForState(previewState, manifest.animations);
  useEffect(() => { setFrame(0); }, [previewState, manifest.id]);
  useEffect(() => {
    const timer = window.setTimeout(() => setFrame((current) => nextCodexPetFrame(previewState, current, manifest.animations)), animation.durations[frame] ?? animation.durations[0]);
    return () => window.clearTimeout(timer);
  }, [animation, frame, manifest.animations, previewState]);
  const frameWidth = 96;
  const frameHeight = frameWidth * manifest.cellHeight / manifest.cellWidth;
  const selectedState = entry.report.states.find((item) => item.state === previewState);
  return <div className="pet-preview-panel" aria-label="皮肤动画预览">
    <div className="pet-preview-stage"><span className="pet-preview-sprite" style={{ width: frameWidth, height: frameHeight, backgroundImage: `url(${asset.dataUrl})`, backgroundSize: `${manifest.columns * frameWidth}px ${manifest.rows * frameHeight}px`, backgroundPosition: `-${(frame % animation.durations.length) * frameWidth}px -${animation.row * frameHeight}px` }} /></div>
    <div className="pet-preview-copy"><strong>动画预览</strong><small>{selectedState?.fallback ? `${PET_STATE_LABELS[previewState]} · 回退到玉衡默认动画` : `${PET_STATE_LABELS[previewState]} · ${selectedState?.frameCount ?? animation.durations.length} 帧 · 平均 ${selectedState?.frameDurationMs ?? Math.round(animation.durations.reduce((sum, value) => sum + value, 0) / animation.durations.length)}ms`}</small><div className="pet-preview-states" role="tablist" aria-label="预览状态">{(Object.keys(PET_STATE_LABELS) as PetState[]).map((state) => <button type="button" key={state} role="tab" aria-selected={previewState === state} className={previewState === state ? 'is-selected' : ''} onClick={() => setPreviewState(state)}>{PET_STATE_LABELS[state]}</button>)}</div><div className="pet-preview-fallbacks" aria-label="状态兼容关系">{entry.report.states.map((state) => <span key={state.state}>{PET_STATE_LABELS[state.state]}：{state.fallback ? '玉衡默认' : 'manifest'}</span>)}</div></div>
  </div>;
}

function PetManagementSettings({ config, pets, assets, loading, onRefresh, onSelect, onToggle, onScaleChange, onLockedChange, onOpacityChange, onAlwaysOnTopChange, onFeedbackChange, onOpenFolder, onImport, onDelete, onReveal, error }: { config: DesktopPetConfig; pets: CodexPetCatalogEntry[]; assets: Record<string, { dataUrl: string; manifest: CodexPetManifest }>; loading: boolean; onRefresh: () => void; onSelect: (petId?: string) => void; onToggle: () => void; onScaleChange: (scale: number) => void; onLockedChange: (locked: boolean) => void; onOpacityChange: (opacity: number) => void; onAlwaysOnTopChange: (alwaysOnTop: boolean) => void; onFeedbackChange: (patch: Partial<DesktopPetConfig>) => void; onOpenFolder: () => void; onImport: () => void; onDelete: (petId: string) => void; onReveal: (petId: string) => void; error: string | null }) {
  const [previewPetId, setPreviewPetId] = useState<string | null>(config.petId ?? null);
  const builtinSelected = !config.petId;
  const feedbackMode = config.feedbackMode ?? 'all';
  const focusActive = typeof config.mutedUntil === 'number' && config.mutedUntil > Date.now();
  const entries: Array<CodexPetCatalogEntry & { builtin?: boolean }> = [{ id: '', displayName: '玉衡', description: '玉衡的默认桌面宠物。', source: 'yuheng', builtin: true, report: { status: 'compatible', expected: { width: 0, height: 0 }, actual: { width: 0, height: 0 }, states: [], issues: [] } }, ...pets];
  const previewEntry = pets.find((pet) => pet.id === previewPetId && isPetRuntimeUsable(pet));
  useEffect(() => {
    if (previewPetId || config.petId) return;
    const first = pets.find((pet) => isPetRuntimeUsable(pet));
    if (first) setPreviewPetId(first.id);
  }, [config.petId, pets, previewPetId]);
  return <div className="settings-section settings-section-first pet-management-section">
    <div className="settings-section-heading pet-management-heading"><div><h3>选择宠物</h3><p>宠物会管理对话，并突出显示需要你关注的事项。</p></div><div className="pet-management-actions"><button type="button" className="icon-button pet-refresh-button" onClick={onRefresh} disabled={loading} aria-label="刷新宠物列表" title="刷新宠物列表"><RefreshCw size={16} className={loading ? 'is-spinning' : ''} /></button><button type="button" className="secondary-action" onClick={onImport}><Upload size={15} aria-hidden="true" />导入皮肤</button><button type="button" className="secondary-action" onClick={onOpenFolder}><FolderOpen size={15} aria-hidden="true" />打开文件夹</button><button type="button" className={`send-button ${config.enabled ? 'is-enabled' : ''}`} onClick={onToggle}>{config.enabled ? '关闭桌面宠物' : '唤醒虚拟宠物'}</button></div></div>
    <div className="pet-catalog" aria-label="宠物列表">
      {loading && <div className="pet-catalog-loading">正在扫描本地宠物...</div>}
      {!loading && entries.map((pet) => {
        const asset = pet.id ? assets[pet.id] : undefined;
        const selected = pet.id ? config.petId === pet.id : builtinSelected;
        const canUse = Boolean(pet.builtin || (isPetRuntimeUsable(pet) && asset));
        const statusLabel = pet.builtin ? '内置' : !isPetRuntimeUsable(pet) ? '不可用' : pet.report.status === 'invalid' ? '可回退' : pet.report.status === 'warning' ? '需注意' : '兼容';
        return <div className={`pet-catalog-row ${selected ? 'is-selected' : ''} ${!canUse ? 'is-invalid' : ''}`} key={pet.id || 'builtin'}>
          <span className={`pet-catalog-preview ${asset ? 'has-sprite' : ''}`} style={asset ? { backgroundImage: `url(${asset.dataUrl})`, backgroundSize: `${asset.manifest.columns * 64}px ${asset.manifest.rows * (64 * asset.manifest.cellHeight / asset.manifest.cellWidth)}px` } : undefined} aria-hidden="true"><span>{asset ? '' : '玉'}</span></span>
          <div className="pet-catalog-copy"><strong>{pet.displayName}</strong><small>{pet.description ?? (pet.source === 'codex' ? '来自 Codex Pet 的本地皮肤。' : '玉衡内置宠物。')}</small>{!pet.builtin && <span className={`pet-compatibility-status is-${pet.report.status}`}>{pet.report.status === 'invalid' ? <AlertTriangle size={13} aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}{statusLabel}{pet.report.issues[0] ? ` · ${pet.report.issues[0].message}` : ''}</span>}</div>
          <div className="pet-catalog-row-actions">{pet.source === 'codex' && <span className="pet-source-tag">Codex</span>}{selected ? <span className="pet-selected-state"><Check size={15} aria-hidden="true" />已选</span> : canUse ? <button type="button" className="secondary-action" onClick={() => { setPreviewPetId(pet.id); onSelect(pet.id || undefined); }}>选择</button> : <span className="pet-selected-state">不可选择</span>}{canUse && !pet.builtin && <button type="button" className="icon-button" onClick={() => setPreviewPetId(pet.id)} aria-label={`预览${pet.displayName}`} title="预览皮肤"><Play size={15} /></button>}{!pet.builtin && pet.manifest && <><button type="button" className="icon-button" onClick={() => onReveal(pet.id)} aria-label={`在 Finder 中显示${pet.displayName}`} title="在 Finder 中显示"><MapPin size={15} /></button><button type="button" className="icon-button pet-delete-button" onClick={() => onDelete(pet.id)} aria-label={`删除${pet.displayName}`} title="删除皮肤"><Trash2 size={15} /></button></>}</div>
        </div>;
      })}
      {!loading && pets.length === 0 && <div className="pet-catalog-empty">未发现 Codex Pet 皮肤。将皮肤目录放入 `~/.codex/pets` 后点击刷新。</div>}
      <div className="pet-catalog-footer"><strong>自定义宠物</strong><span>支持 `pet.json` + `spritesheet.webp` 的 Codex Pet 格式；异常包会保留在列表中供诊断。</span><button type="button" className="text-button" onClick={onOpenFolder}>打开文件夹 <ExternalLink size={14} aria-hidden="true" /></button></div>
    </div>
    {previewEntry && assets[previewEntry.id] && <PetSkinPreview entry={previewEntry} asset={assets[previewEntry.id]} />}
    {error && <p className="form-error pet-management-error" role="alert">{error}</p>}
    <div className="pet-appearance-panel"><div><strong>宠物大小</strong><small>桌面宠物窗口的显示比例 · {Math.round((config.scale ?? 1) * 100)}%</small></div><input type="range" min="80" max="140" step="5" value={Math.round((config.scale ?? 1) * 100)} onChange={(event) => onScaleChange(Number(event.target.value) / 100)} aria-label="宠物大小" /></div>
    <div className="pet-control-panel" aria-label="宠物行为设置">
      <div className="plugin-toggle-row pet-control-row"><div><strong>锁定位置</strong><small>锁定后不能拖动，但仍可以点击宠物打开玉衡。</small></div><button type="button" className={`switch-control ${config.locked ? 'is-on' : ''}`} role="switch" aria-checked={config.locked === true} aria-label={config.locked ? '解锁宠物位置' : '锁定宠物位置'} onClick={() => onLockedChange(!config.locked)}><span /></button></div>
      <div className="plugin-toggle-row pet-control-row"><div><strong>始终置顶</strong><small>让宠物保持在其他窗口上方。</small></div><button type="button" className={`switch-control ${config.alwaysOnTop !== false ? 'is-on' : ''}`} role="switch" aria-checked={config.alwaysOnTop !== false} aria-label={config.alwaysOnTop !== false ? '关闭宠物置顶' : '开启宠物置顶'} onClick={() => onAlwaysOnTopChange(config.alwaysOnTop === false)}><span /></button></div>
      <div className="plugin-toggle-row pet-control-row"><div><strong>边缘吸附</strong><small>拖动后靠近屏幕边缘时自动对齐。</small></div><button type="button" className={`switch-control ${config.edgeSnap === true ? 'is-on' : ''}`} role="switch" aria-checked={config.edgeSnap === true} aria-label={config.edgeSnap === true ? '关闭边缘吸附' : '开启边缘吸附'} onClick={() => onFeedbackChange({ edgeSnap: config.edgeSnap !== true })}><span /></button></div>
      <div className="plugin-toggle-row pet-control-row"><div><strong>轻微惯性</strong><small>松开鼠标后保留短暂的移动惯性，默认关闭。</small></div><button type="button" className={`switch-control ${config.inertia === true ? 'is-on' : ''}`} role="switch" aria-checked={config.inertia === true} aria-label={config.inertia === true ? '关闭轻微惯性' : '开启轻微惯性'} onClick={() => onFeedbackChange({ inertia: config.inertia !== true })}><span /></button></div>
      <div className="plugin-toggle-row pet-control-row"><div><strong>边界回弹</strong><small>惯性到达屏幕边界时轻微回弹；需要先开启惯性。</small></div><button type="button" className={`switch-control ${config.boundaryBounce === true ? 'is-on' : ''}`} role="switch" aria-checked={config.boundaryBounce === true} aria-label={config.boundaryBounce === true ? '关闭边界回弹' : '开启边界回弹'} onClick={() => onFeedbackChange({ boundaryBounce: config.boundaryBounce !== true })}><span /></button></div>
      <div className="pet-opacity-control"><div><strong>不透明度</strong><small>降低透明度不会关闭宠物交互 · {Math.round((config.opacity ?? 1) * 100)}%</small></div><input type="range" min="20" max="100" step="5" value={Math.round((config.opacity ?? 1) * 100)} onChange={(event) => onOpacityChange(Number(event.target.value) / 100)} aria-label="宠物不透明度" /></div>
    </div>
    <div className="pet-feedback-settings">
      <div className="pet-feedback-heading"><strong>反馈与打扰</strong><small>控制宠物何时显示气泡；提示音默认关闭。</small></div>
      <div className="pet-feedback-mode" role="radiogroup" aria-label="宠物气泡模式">
        {([['important', '重要状态'], ['all', '全部状态'], ['hidden', '隐藏气泡']] as const).map(([value, label]) => <button type="button" key={value} role="radio" aria-checked={feedbackMode === value} className={feedbackMode === value ? 'is-selected' : ''} onClick={() => onFeedbackChange({ feedbackMode: value })}>{label}</button>)}
      </div>
      <div className="pet-feedback-toggles">
        <div className="plugin-toggle-row pet-control-row"><div><strong>完成提示</strong><small>任务完成后显示简短庆祝反馈。</small></div><button type="button" className={`switch-control ${config.completionFeedback !== false ? 'is-on' : ''}`} role="switch" aria-checked={config.completionFeedback !== false} onClick={() => onFeedbackChange({ completionFeedback: config.completionFeedback === false })}><span /></button></div>
        <div className="plugin-toggle-row pet-control-row"><div><strong>错误提示</strong><small>运行失败时提示并支持定位执行记录。</small></div><button type="button" className={`switch-control ${config.errorFeedback !== false ? 'is-on' : ''}`} role="switch" aria-checked={config.errorFeedback !== false} onClick={() => onFeedbackChange({ errorFeedback: config.errorFeedback === false })}><span /></button></div>
        <div className="plugin-toggle-row pet-control-row"><div><strong>审批提示</strong><small>需要确认工具操作时提醒你处理。</small></div><button type="button" className={`switch-control ${config.approvalFeedback !== false ? 'is-on' : ''}`} role="switch" aria-checked={config.approvalFeedback !== false} onClick={() => onFeedbackChange({ approvalFeedback: config.approvalFeedback === false })}><span /></button></div>
        <div className="plugin-toggle-row pet-control-row"><div><strong>提示音</strong><small>仅在完成、错误或等待审批时播放轻提示音。</small></div><button type="button" className={`switch-control ${config.soundEnabled === true ? 'is-on' : ''}`} role="switch" aria-checked={config.soundEnabled === true} onClick={() => onFeedbackChange({ soundEnabled: config.soundEnabled !== true })}><span /></button></div>
      </div>
      <div className="pet-focus-control"><div><strong>{focusActive ? '专注中' : '临时专注'}</strong><small>{focusActive ? `反馈已暂停至 ${new Date(config.mutedUntil!).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '临时暂停气泡和提示音，不会关闭宠物。'}</small></div><button type="button" className="secondary-action" onClick={() => onFeedbackChange({ mutedUntil: focusActive ? undefined : Date.now() + 30 * 60 * 1_000 })}>{focusActive ? '提前结束' : '专注 30 分钟'}</button></div>
    </div>
  </div>;
}

function SettingsWorkspace({ appInfo, current, providers, browserUseConfig, computerUseConfig, desktopPetConfig: configuredDesktopPet, initialSection = 'provider', theme, onThemeChange, onClose, onSaved, onProvidersChange, onBrowserUseChange, onComputerUseChange, onDesktopPetChange }: { appInfo: AppInfo | null; current: ProviderConfig | null; providers: ProviderConfig[]; browserUseConfig: BrowserUseConfig; computerUseConfig: ComputerUseConfig; desktopPetConfig?: DesktopPetConfig; initialSection?: SettingsSection; theme: ThemeName; onThemeChange: (theme: ThemeName) => void; onClose: () => void; onSaved: (provider: ProviderConfig) => void; onProvidersChange: (providers: ProviderConfig[]) => void; onBrowserUseChange: (config: BrowserUseConfig) => void; onComputerUseChange: (config: ComputerUseConfig) => void; onDesktopPetChange?: (config: DesktopPetConfig) => void }) {
  const [localDesktopPet, setLocalDesktopPet] = useState<DesktopPetConfig>(configuredDesktopPet ?? { enabled: false });
  const [petOptions, setPetOptions] = useState<CodexPetCatalogEntry[]>([]);
  const [petAssets, setPetAssets] = useState<Record<string, { dataUrl: string; manifest: CodexPetManifest }>>({});
  const [petLoading, setPetLoading] = useState(false);
  const [petError, setPetError] = useState<string | null>(null);
  const desktopPetConfig = configuredDesktopPet ?? localDesktopPet;
  useEffect(() => {
    if (configuredDesktopPet) return;
    const activeBridge = getBridge();
    if (activeBridge) void activeBridge.pet.get().then(setLocalDesktopPet).catch(() => undefined);
  }, [configuredDesktopPet]);
  const refreshPets = async () => {
    const activeBridge = getBridge();
    if (!activeBridge || petLoading) return;
    setPetLoading(true);
    setPetError(null);
    try {
      const catalog = await activeBridge.pet.catalog();
      setPetOptions(catalog);
      const loaded = await Promise.all(catalog.filter((pet) => isPetRuntimeUsable(pet)).map(async (pet) => {
        try { const asset = await activeBridge.pet.asset(pet.id); return asset ? [pet.id, asset] as const : null; } catch { return null; }
      }));
      setPetAssets(Object.fromEntries(loaded.filter((item): item is [string, { dataUrl: string; manifest: CodexPetManifest }] => Boolean(item))));
    } catch (reason) { setPetError(reason instanceof Error ? reason.message : '读取皮肤列表失败。'); setPetOptions([]); setPetAssets({}); }
    finally { setPetLoading(false); }
  };
  useEffect(() => { void refreshPets(); }, []);
  const importPet = async () => {
    const activeBridge = getBridge();
    if (!activeBridge || petLoading) return;
    try {
      const imported = await activeBridge.pet.import();
      if (imported) { await refreshPets(); await selectDesktopPet(imported.id); }
    } catch (reason) { setPetError(reason instanceof Error ? reason.message : '导入皮肤失败。'); }
  };
  const deletePet = async (petId: string) => {
    const activeBridge = getBridge();
    const pet = petOptions.find((entry) => entry.id === petId);
    if (!activeBridge || !pet || !window.confirm(`删除皮肤“${pet.displayName}”？`)) return;
    try { await activeBridge.pet.delete(petId); await refreshPets(); }
    catch (reason) { setPetError(reason instanceof Error ? reason.message : '删除皮肤失败。'); }
  };
  const revealPet = async (petId: string) => {
    const activeBridge = getBridge();
    if (!activeBridge) return;
    try { await activeBridge.pet.reveal(petId); }
    catch (reason) { setPetError(reason instanceof Error ? reason.message : '打开皮肤位置失败。'); }
  };
  const [activeSection, setActiveSection] = useState<SettingsSection>(() => normalizeSettingsSection(initialSection));
  useEffect(() => { setActiveSection(normalizeSettingsSection(initialSection)); }, [initialSection]);
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
  const toggleDesktopPet = async () => {
    const activeBridge = getBridge();
    if (!activeBridge) return;
    try {
      const saved = await activeBridge.pet.save({ ...desktopPetConfig, enabled: !desktopPetConfig.enabled });
      setLocalDesktopPet(saved);
      onDesktopPetChange?.(saved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '更新桌面宠物设置失败。');
    }
  };
  const selectDesktopPet = async (petId?: string) => {
    const activeBridge = getBridge();
    if (!activeBridge) return;
    try {
      const saved = await activeBridge.pet.save({ ...desktopPetConfig, enabled: desktopPetConfig.enabled, ...(petId ? { petId } : { petId: undefined }) });
      setLocalDesktopPet(saved);
      onDesktopPetChange?.(saved);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '切换宠物失败。'); }
  };
  const scaleDesktopPet = async (scale: number) => {
    const activeBridge = getBridge();
    if (!activeBridge) return;
    try {
      const saved = await activeBridge.pet.save({ ...desktopPetConfig, scale });
      setLocalDesktopPet(saved);
      onDesktopPetChange?.(saved);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '调整宠物大小失败。'); }
  };
  const updateDesktopPetControl = async (patch: Partial<DesktopPetConfig>) => {
    const activeBridge = getBridge();
    if (!activeBridge) return;
    try {
      const saved = await activeBridge.pet.save({ ...desktopPetConfig, ...patch });
      setLocalDesktopPet(saved);
      onDesktopPetChange?.(saved);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '更新桌面宠物设置失败。'); }
  };
  const sectionCopy: Record<SettingsSection, { title: string; description: string }> = {
    provider: { title: '模型服务', description: '配置玉衡用于会话和任务处理的语言模型。' },
    capabilities: { title: 'Agent 能力', description: '管理需要额外运行环境或系统权限的可选能力。' },
    appearance: { title: '界面外观', description: '调整玉衡在这台设备上的显示方式。' },
    pet: { title: '宠物', description: '选择、管理和唤醒玉衡桌面宠物。' },
    desktop: { title: '通知与驻留', description: '控制任务提醒和 macOS 菜单栏驻留行为。' },
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
        <button type="button" className={activeSection === 'pet' ? 'is-selected' : ''} aria-current={activeSection === 'pet' ? 'page' : undefined} onClick={() => setActiveSection('pet')}><PawPrint size={15} aria-hidden="true" /><span>宠物</span></button>
        <button type="button" className={activeSection === 'desktop' ? 'is-selected' : ''} aria-current={activeSection === 'desktop' ? 'page' : undefined} onClick={() => setActiveSection('desktop')}><Bell size={15} aria-hidden="true" /><span>通知与驻留</span></button>
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

      {activeSection === 'pet' && <PetManagementSettings config={desktopPetConfig} pets={petOptions} assets={petAssets} loading={petLoading} error={petError} onRefresh={() => void refreshPets()} onSelect={(petId) => void selectDesktopPet(petId)} onToggle={() => void toggleDesktopPet()} onScaleChange={(scale) => void scaleDesktopPet(scale)} onLockedChange={(locked) => void updateDesktopPetControl({ locked })} onOpacityChange={(opacity) => void updateDesktopPetControl({ opacity })} onAlwaysOnTopChange={(alwaysOnTop) => void updateDesktopPetControl({ alwaysOnTop })} onFeedbackChange={(patch) => void updateDesktopPetControl(patch)} onOpenFolder={() => { const activeBridge = getBridge(); if (activeBridge) void activeBridge.pet.openFolder(); }} onImport={() => void importPet()} onDelete={(petId) => void deletePet(petId)} onReveal={(petId) => void revealPet(petId)} />}

      {activeSection === 'backup' && <BackupSettings />}
      {activeSection === 'desktop' && <DesktopPresenceSettings />}

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

function DesktopPresenceSettings() {
  const [config, setConfig] = useState<{ notificationsEnabled: boolean; menuBarEnabled: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { const bridge = getBridge(); if (bridge) void bridge.desktopPresence.getConfig().then(setConfig).catch(() => undefined); }, []);
  const toggle = async (key: 'notificationsEnabled' | 'menuBarEnabled') => {
    const bridge = getBridge(); if (!bridge || !config || saving) return;
    setSaving(true); setError(null);
    try { setConfig(await bridge.desktopPresence.saveConfig({ ...config, [key]: !config[key] })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '保存设置失败。'); }
    finally { setSaving(false); }
  };
  return <div className="settings-section settings-section-first desktop-presence-section"><div className="settings-section-heading"><div><h3>系统提醒</h3><p>任务到期时显示 macOS 通知中心横幅。需要在系统设置中允许玉衡发送通知。</p></div></div><div className="plugin-toggle-row"><div><strong>任务通知</strong><small>关闭后不会弹出系统通知，但任务提醒仍会保留在玉衡内。</small></div><button type="button" className={`switch-control ${config?.notificationsEnabled ? 'is-on' : ''}`} role="switch" aria-checked={config?.notificationsEnabled ?? false} aria-label={config?.notificationsEnabled ? '关闭任务通知' : '开启任务通知'} onClick={() => void toggle('notificationsEnabled')} disabled={!config || saving}><span /></button></div><div className="settings-section-heading desktop-presence-subheading"><div><h3>菜单栏驻留</h3><p>关闭主窗口后继续在后台运行，并从 macOS 菜单栏快速打开玉衡。</p></div></div><div className="plugin-toggle-row"><div><strong>显示菜单栏图标</strong><small>关闭后玉衡仍可通过通知运行，但不显示顶部菜单栏图标。</small></div><button type="button" className={`switch-control ${config?.menuBarEnabled ? 'is-on' : ''}`} role="switch" aria-checked={config?.menuBarEnabled ?? false} aria-label={config?.menuBarEnabled ? '隐藏菜单栏图标' : '显示菜单栏图标'} onClick={() => void toggle('menuBarEnabled')} disabled={!config || saving}><span /></button></div>{error && <p className="form-error" role="alert">{error}</p>}</div>;
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
    try { const report = await bridge.backup.import(); if (report) setStatus(`已导入 ${report.conversations} 个会话、${report.messages} 条消息、${report.tasks} 个任务和 ${report.notes} 个笔记${report.missingProviders ? `；${report.missingProviders} 个 Provider 需要重新配置` : ''}${report.contextUnavailable ? '；部分 Agent 上下文未恢复' : ''}。`); }
    catch (error) { setStatus(error instanceof Error ? error.message : '导入备份失败。'); }
    finally { setBusy(false); }
  };
  const toggleAutomatic = async () => { const bridge = getBridge(); if (!bridge || !config) return; const saved = await bridge.backup.saveConfig({ enabled: !config.enabled, directory: config.directory, retention: config.retention }); setConfig(saved); };
  return <div className="settings-section settings-section-first desktop-backup-section"><div className="settings-section-heading"><div><h3>完整备份</h3><p>包含会话、任务、运行记录、受控附件和已配置的 Provider API Key，不包含 workspace 文件。备份文件未加密，请妥善保管。</p></div></div><div className="provider-modal-actions"><button type="button" className="secondary-action" onClick={() => void importBackup()} disabled={busy}>导入 .yuheng</button><button type="button" className="send-button" onClick={() => void exportBackup()} disabled={busy}>{busy ? '处理中…' : '导出完整备份'}</button></div><div className="plugin-toggle-row"><div><strong>自动备份</strong><small>每天最多一次；检测到运行中任务时跳过本轮。</small></div><button type="button" className={`switch-control ${config?.enabled ? 'is-on' : ''}`} role="switch" aria-checked={config?.enabled ?? false} aria-label="开启自动备份" onClick={() => void toggleAutomatic()} disabled={!config || busy}><span /></button></div>{config?.lastRunAt && <small>最近成功：{new Date(config.lastRunAt).toLocaleString('zh-CN')}</small>}{config?.lastError && <p className="form-error" role="alert">{config.lastError}</p>}{status && <p className="provider-test-result" role="status">{status}</p>}</div>;
}

export function ProductionRenderer() {
  const activeBridge = getBridge();
  const settings = useSettingsController(activeBridge);
  const { appInfo, provider, setProvider, providers, setProviders, browserUse: browserUseConfig, setBrowserUse: setBrowserUseConfig, computerUse: computerUseConfig, setComputerUse: setComputerUseConfig, theme, setTheme } = settings;
  const [windowFullscreen, setWindowFullscreen] = useState(false);
  const [activeView, setActiveViewState] = useState<'conversation' | 'tasks' | 'notes'>('conversation');
  const [sidebarMode, setSidebarModeState] = useState<'conversation' | 'tasks' | 'notes'>('conversation');
  const setActiveView = (next: 'conversation' | 'tasks' | 'notes') => {
    setSidebarModeState(next);
    if (typeof document === 'undefined') { setActiveViewState(next); return; }
    const viewTransitionDocument = document as Document & { startViewTransition?: (callback: () => void) => unknown };
    if (viewTransitionDocument.startViewTransition) viewTransitionDocument.startViewTransition(() => setActiveViewState(next));
    else setActiveViewState(next);
  };
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [newProviderId, setNewProviderId] = useState('');
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
  const [permissionConfirmationOpen, setPermissionConfirmationOpen] = useState(false);
  const [permissionSaving, setPermissionSaving] = useState(false);
  const providerOpen = settings.mounted;
  const settingsMounted = settings.mounted;
  const settingsInitialSection = settings.initialSection;
  const settingsClosing = settings.closing;
  const [pendingApproval, setPendingApproval] = useState<Extract<RunEvent, { type: 'approval_required' }> | null>(null);
  const [approvalClosing, setApprovalClosing] = useState(false);
  const approvalCloseTimerRef = useRef<number | null>(null);
  const [copiedConversationId, setCopiedConversationId] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryDraft, setRetryDraft] = useState<{ messageId: string; content: string } | null>(null);
  const [retryingRun, setRetryingRun] = useState(false);
  const retryingRunRef = useRef(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [requestedOpenTaskId, setRequestedOpenTaskId] = useState<string | null>(null);
  const [taskActionRequest, setTaskActionRequest] = useState<{ kind: 'today' | 'quick_record'; id: number } | null>(null);
  const taskWorkspace = useTaskWorkspace(activeBridge, ({ boardId, taskId, action }) => {
    settings.close();
    setRequestedOpenTaskId(taskId ?? null);
    if (action) setTaskActionRequest({ kind: action, id: Date.now() });
    openWorkspaceTab('tasks', boardId);
  });
  const { boards: taskBoards, activeBoardId: activeTaskBoardId, setActiveBoardId: setActiveTaskBoardId, tasks, types: taskTypes, loading: tasksLoading } = taskWorkspace;
  const noteWorkspace = useNoteWorkspace(activeBridge);
  const { activeNoteId, setActiveNoteId, titles: noteTitles, revision: notesRevision, notifyChanged: notifyNotesChanged } = noteWorkspace;
  const conversation = useConversationWorkspace(activeBridge, {
    providers,
    provider,
    onOpenSettings: settings.open,
    onError: (message) => { if (message) setError(message); },
    onApprovalRequired: (event) => { if (approvalCloseTimerRef.current !== null) window.clearTimeout(approvalCloseTimerRef.current); setApprovalClosing(false); setPendingApproval(event); },
    onApprovalResolved: (approvalId) => { if (pendingApproval?.approvalId === approvalId) setPendingApproval(null); },
  });
  const { items: conversationItems, setItems: setConversationItems, projects: conversationProjects, setProjects: setConversationProjects, workspaceLoaded, activeId: activeConversation, setActiveId: setActiveConversation, activeProjectId: activeConversationProject, setActiveProjectId: setActiveConversationProject, activeProfileId, setActiveProfileId, messages, setMessages, runs: conversationRuns, setRuns: setConversationRuns, activities: toolActivities, setActivities: setToolActivities, activeRun, setActiveRun, interruptedRun, setInterruptedRun, reasoningSelection, setReasoningSelection, permissionMode, setPermissionMode, activeMessages, activeActivities, isThinking, activeTitle, refresh: refreshConversationList } = conversation;
  useEffect(() => {
    setNewProviderId((current) => providers.some((item) => item.id === current) ? current : (provider?.id ?? providers[0]?.id ?? ''));
  }, [provider, providers]);
  const [workspaceTabs, setWorkspaceTabs] = useState<WorkspaceTab[]>(readStoredWorkspaceTabs);
  const [activeTabId, setActiveTabId] = useState(() => {
    const tabs = readStoredWorkspaceTabs();
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('yuheng-active-workspace-tab') : null;
    return stored && tabs.some((tab) => tab.id === stored) ? stored : tabs[0].id;
  });
  const [tabContextMenu, setTabContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
  const restoredWorkspaceRef = useRef(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [requestedMessageId, setRequestedMessageId] = useState<string | null>(null);
  const [requestedRunId, setRequestedRunId] = useState<string | null>(null);
  const [requestedApprovalId, setRequestedApprovalId] = useState<string | null>(null);
  const [composerPrefill, setComposerPrefill] = useState<{ id: number; value: string } | null>(null);
  useEffect(() => {
    if (!activeBridge) return;
    return activeBridge.app.onFullscreen(setWindowFullscreen);
  }, [activeBridge]);
  useEffect(() => { localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth)); }, [sidebarWidth]);
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('yuheng-workspace-tabs', JSON.stringify(workspaceTabs));
    localStorage.setItem('yuheng-active-workspace-tab', activeTabId);
  }, [workspaceTabs, activeTabId]);
  useEffect(() => {
    const close = () => setTabContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    return () => { window.removeEventListener('click', close); window.removeEventListener('blur', close); };
  }, []);

  const openWorkspaceTab = (type: WorkspaceTab['type'], resourceId: string) => {
    const id = `${type}:${resourceId}`;
    setWorkspaceTabs((current) => current.some((tab) => tab.id === id) ? current : [...current, { id, type, resourceId }]);
    setActiveTabId(id);
    setActiveView(type);
    if (type === 'conversation') setActiveConversation(resourceId);
    if (type === 'tasks') setActiveTaskBoardId(resourceId);
    if (type === 'notes') setActiveNoteId(resourceId);
  };
  const closeWorkspaceTab = (id: string) => {
    const index = workspaceTabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const next = workspaceTabs.filter((tab) => tab.id !== id);
    setWorkspaceTabs(next);
    if (id === activeTabId) {
      if (!next.length) {
        setActiveTabId('');
        setActiveView('conversation');
        setTabContextMenu(null);
        return;
      }
      const fallback = next[Math.min(index < 0 ? 0 : index, next.length - 1)];
      activateWorkspaceTab(fallback);
    }
  };
  const closeWorkspaceTabs = (ids: string[]) => {
    if (!ids.length) return;
    const closing = new Set(ids);
    const activeWasClosed = closing.has(activeTabId);
    const activeIndex = workspaceTabs.findIndex((tab) => tab.id === activeTabId);
    const next = workspaceTabs.filter((tab) => !closing.has(tab.id));
    setWorkspaceTabs(next);
    if (activeWasClosed && next.length) {
      const fallback = next[Math.min(Math.max(activeIndex, 0), next.length - 1)];
      activateWorkspaceTab(fallback);
    }
    setTabContextMenu(null);
  };
  const activateWorkspaceTab = (tab: WorkspaceTab) => {
    if (tab.id === activeTabId) return;
    setActiveTabId(tab.id);
    if (tab.type === 'conversation') selectConversation(tab.resourceId);
    else if (tab.type === 'tasks') { setActiveTaskBoardId(tab.resourceId); setActiveView('tasks'); }
    else { setActiveNoteId(tab.resourceId); setActiveView('notes'); }
  };

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

  const openSettings = settings.open;
  const closeSettings = settings.close;
  useEffect(() => () => {
    if (approvalCloseTimerRef.current !== null) window.clearTimeout(approvalCloseTimerRef.current);
    if (profileMenuCloseTimerRef.current !== null) window.clearTimeout(profileMenuCloseTimerRef.current);
    if (providerMenuCloseTimerRef.current !== null) window.clearTimeout(providerMenuCloseTimerRef.current);
  }, []);

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
    if (!permissionConfirmationOpen) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setPermissionConfirmationOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [permissionConfirmationOpen]);

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

  const activeProfile = AGENT_PROFILES.find((profile) => profile.id === activeProfileId) ?? AGENT_PROFILES[0];
  const activeProviderId = conversationItems.find((conversation) => conversation.id === activeConversation)?.providerId ?? newProviderId;
  const activeProvider = providers.find((item) => item.id === activeProviderId) ?? null;
  const latestCompletedRun = conversationRuns[activeConversation]?.find((run) => run.status === 'completed' && run.usage) ?? null;
  const latestUsage = latestCompletedRun?.usage ? { ...latestCompletedRun.usage, durationMs: Math.max(0, Date.parse(latestCompletedRun.finishedAt ?? latestCompletedRun.startedAt) - Date.parse(latestCompletedRun.startedAt)) } : null;
  const conversationIsEmpty = activeMessages.length === 0 && activeActivities.length === 0 && !isThinking && !interruptedRun;
  const visibleError = error ?? taskWorkspace.error ?? settings.error;
  const releaseAttachments = (items: Attachment[]) => {
    if (items.length > 0 && activeBridge) void activeBridge.attachments.release(items.map((item) => item.id));
  };
  const selectConversation = (id: string) => { releaseAttachments(attachments); setError(null); setInterruptedRun(null); setAttachments([]); setComposerPrefill(null); setRequestedMessageId(null); setRequestedRunId(null); setRequestedApprovalId(null); setRequestedOpenTaskId(null); setActiveConversation(id); const conversation = conversationItems.find((item) => item.id === id); const projectId = conversation?.projectId; if (projectId) setActiveConversationProject(projectId); setActiveProfileId(conversation?.profileId ?? DEFAULT_AGENT_PROFILE_ID); const providerId = conversation?.providerId ?? providers[0]?.id; setProvider(providers.find((item) => item.id === providerId) ?? null); if (providerId) setNewProviderId(providerId); openWorkspaceTab('conversation', id); };
  useEffect(() => {
    if (!activeBridge || !workspaceLoaded) return;
    const openTarget = (target: PetOpenTarget) => {
      if (target.kind === 'task') {
        closeSettings();
        const boardId = taskBoards.some((board) => board.id === target.boardId) ? target.boardId : taskBoards[0]?.id;
        if (!boardId) return;
        setActiveView('tasks');
        setActiveTaskBoardId(boardId);
        setRequestedOpenTaskId(boardId === target.boardId ? target.taskId : null);
        openWorkspaceTab('tasks', boardId);
        return;
      }
      if (!conversationItems.some((item) => item.id === target.conversationId)) return;
      closeSettings();
      selectConversation(target.conversationId);
      if (target.kind === 'conversation' && target.messageId) setRequestedMessageId(target.messageId);
      else if (target.kind === 'run') setRequestedRunId(target.runId);
      else if (target.kind === 'approval') setRequestedApprovalId(target.approvalId);
    };
    const unsubscribe = activeBridge.pet.onOpenTarget(openTarget);
    void activeBridge.pet.takeOpenTarget().then((target) => { if (target) openTarget(target); }).catch(() => undefined);
    return unsubscribe;
  }, [activeBridge, conversationItems, workspaceLoaded]);
  useEffect(() => {
    if (!requestedApprovalId || pendingApproval?.approvalId !== requestedApprovalId) return;
    const frame = window.requestAnimationFrame(() => {
      const target = Array.from(document.querySelectorAll<HTMLElement>('[data-approval-id]')).find((element) => element.dataset.approvalId === requestedApprovalId);
      target?.focus({ preventScroll: false });
      setRequestedApprovalId(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingApproval, requestedApprovalId]);
  useEffect(() => {
    if (restoredWorkspaceRef.current || !activeBridge) return;
    const tab = workspaceTabs.find((item) => item.id === activeTabId);
    if (!tab) return;
    if (tab.type === 'conversation') {
      if (!conversationItems.some((item) => item.id === tab.resourceId)) return;
      restoredWorkspaceRef.current = true;
      selectConversation(tab.resourceId);
    } else if (tab.type === 'tasks') {
      if (!taskBoards.some((board) => board.id === tab.resourceId)) return;
      restoredWorkspaceRef.current = true;
      setActiveTaskBoardId(tab.resourceId);
      setActiveView('tasks');
    } else {
      restoredWorkspaceRef.current = true;
      setActiveNoteId(tab.resourceId);
      setActiveView('notes');
    }
  }, [activeBridge, activeTabId, conversationItems, taskBoards, workspaceTabs]);
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
  const refreshConversations = refreshConversationList;
  const createConversation = async (projectId = activeConversationProject, providerId = newProviderId, profileId = DEFAULT_AGENT_PROFILE_ID) => {
    closeSettings();
    setComposerPrefill(null);
    if (!activeBridge) return selectConversation('inbox');
    try { const created = await activeBridge.conversations.create(undefined, projectId, providerId || undefined, profileId); setConversationItems((items) => sortConversations([created, ...items])); setActiveConversation(created.id); setActiveConversationProject(created.projectId); setActiveProfileId(created.profileId); setProvider(providers.find((item) => item.id === created.providerId) ?? null); if (created.providerId) setNewProviderId(created.providerId); openWorkspaceTab('conversation', created.id); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '新建会话失败。'); }
  };
  const runTemporaryAi = async (title: string, prompt: string, signal?: AbortSignal): Promise<string> => {
    if (!activeBridge) throw new Error('页面 AI 仅在桌面应用中可用。');
    if (!provider?.hasApiKey) throw new Error('请先配置可用的 Provider API Key。');
    if (signal?.aborted) throw new Error('页面 AI 请求已停止。');
    const temporary = await activeBridge.conversations.create(title, activeConversationProject, activeProviderId || newProviderId || undefined, activeProfileId);
    let runId: string | null = null;
    let unsubscribe: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortHandler: (() => void) | undefined;
    try {
      const result = new Promise<string>((resolve, reject) => {
        abortHandler = () => {
          if (runId) void activeBridge.runs.cancel(runId);
          reject(new Error('页面 AI 请求已停止。'));
        };
        if (signal?.aborted) return abortHandler();
        signal?.addEventListener('abort', abortHandler, { once: true });
        unsubscribe = activeBridge.runs.onEvent((event) => {
          if (event.conversationId !== temporary.id || (runId && event.runId !== runId)) return;
          if (event.type === 'failed') reject(new Error(event.error));
          if (event.type === 'cancelled') reject(new Error('笔记 AI 操作已取消。'));
          if (event.type === 'completed') {
            void activeBridge.conversations.messages(temporary.id).then((messages) => {
              const assistant = [...messages].reverse().find((message) => message.role === 'assistant');
              if (assistant) resolve(assistant.content);
              else reject(new Error('玉衡没有返回可预览的内容。'));
            }).catch(reject);
          }
        });
        timer = setTimeout(() => reject(new Error('页面 AI 操作超时。')), 180_000);
      });
      const started = await activeBridge.runs.start(temporary.id, prompt, [], reasoningSelection === 'default' ? undefined : reasoningSelection);
      runId = started.runId;
      if (signal?.aborted) void activeBridge.runs.cancel(runId);
      const content = await result;
      await activeBridge.conversations.archive(temporary.id, true).catch(() => undefined);
      return content;
    } finally {
      if (timer) clearTimeout(timer);
      const cleanup = unsubscribe;
      if (cleanup) cleanup();
      if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
      await activeBridge.conversations.archive(temporary.id, true).catch(() => undefined);
    }
  };
  const runAiForNote = async (note: import('../contracts/desktop-bridge').Note, action: NoteAiAction, customInstruction?: string, signal?: AbortSignal): Promise<string> => runTemporaryAi(`笔记 AI：${note.title}`, buildNoteAiPrompt(note, action, customInstruction), signal);
  const runAiForBoard = async (boardName: string, tasks: import('../contracts/desktop-bridge').Task[], prompt: string, signal?: AbortSignal): Promise<string> => {
    const statusNames = new Map(taskTypes.map((type) => [type.id, type.name]));
    const context = buildBoardAiContext(boardName, tasks.map((task) => ({ title: task.title, status: statusNames.get(task.status) ?? task.status, priority: task.priority, dueAt: task.dueAt })));
    return runTemporaryAi(`看板 AI：${boardName}`, buildContextAiPrompt(context, prompt), signal);
  };
  const branchConversation = async (message: TranscriptMessage) => {
    if (!activeBridge || !message.id) return;
    try {
      const created = await activeBridge.conversations.branch(activeConversation, message.id);
      const branchedMessages = await activeBridge.conversations.messages(created.id);
      setConversationItems((items) => sortConversations([created, ...items.filter((item) => item.id !== created.id)]));
      setMessages((current) => ({ ...current, [created.id]: branchedMessages.map(displayMessage) }));
      setConversationRuns((current) => ({ ...current, [created.id]: [] }));
      setToolActivities((current) => ({ ...current, [created.id]: [] }));
      setActiveConversation(created.id);
      setActiveConversationProject(created.projectId);
      setActiveProfileId(created.profileId);
      setProvider(providers.find((item) => item.id === created.providerId) ?? provider);
      if (created.providerId) setNewProviderId(created.providerId);
      setInterruptedRun(null);
      setActiveView('conversation');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '创建会话分支失败。'); }
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
  const savePermissionMode = async (mode: ToolPermissionMode) => {
    if (!activeBridge || permissionSaving) return;
    const conversationId = activeConversation;
    setPermissionSaving(true);
    setError(null);
    try {
      const saved = await activeBridge.permissions.save(conversationId, mode);
      if (activeConversation === conversationId) {
        setPermissionMode(saved);
        setPermissionConfirmationOpen(false);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存会话权限失败。');
    } finally {
      setPermissionSaving(false);
    }
  };
  const selectPermissionMode = (mode: ToolPermissionMode) => {
    if (mode === 'full_session') {
      setPermissionConfirmationOpen(true);
      return;
    }
    void savePermissionMode(mode);
  };
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
  const createTask = taskWorkspace.create;
  const createTaskFromNote = async (note: import('../contracts/desktop-bridge').Note) => {
    const boardId = activeTaskBoardId || taskBoards[0]?.id;
    if (!boardId) { setError('请先创建一个任务看板。'); return; }
    try {
      taskWorkspace.setActiveBoardId(boardId);
      const task = await taskWorkspace.create({ ...taskDraftFromNote(note), sourceConversationId: null });
      taskWorkspace.setActiveBoardId(boardId);
      setRequestedOpenTaskId(task.id);
      setActiveView('tasks');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '从笔记创建任务失败。'); }
  };
  const createTaskFromMessage = async (message: TranscriptMessage) => {
    if (!activeTaskBoardId) { setError('请先创建一个任务看板。'); return; }
    try {
      const task = await createTask({ ...taskDraftFromMessage(message.content), sourceConversationId: activeConversation });
      setActiveTaskBoardId(task.boardId);
      setRequestedOpenTaskId(task.id);
      setActiveView('tasks');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '从消息创建任务失败。'); }
  };
  const updateTask = taskWorkspace.update;
  const deleteTask = taskWorkspace.remove;
  const reorderTask = taskWorkspace.reorder;
  const moveTaskToBoard = taskWorkspace.moveToBoard;
  const copyTaskToBoard = taskWorkspace.copyToBoard;
  const createTaskType = taskWorkspace.createType;
  const renameTaskType = taskWorkspace.renameType;
  const deleteTaskType = taskWorkspace.deleteType;
  const createTaskBoard = async (name: string): Promise<void> => {
    if (!activeBridge) throw new Error('任务看板仅在桌面应用中可用。');
    const board = await taskWorkspace.createBoard(name);
    if (!board) return;
    closeSettings();
    setActiveView('tasks');
  };
  const renameTaskBoard = taskWorkspace.renameBoard;
  const reorderTaskBoard = taskWorkspace.reorderBoard;
  const deleteTaskBoard = taskWorkspace.deleteBoard;
  const importTaskAsset = taskWorkspace.importAsset;
  const pickTaskAssets = taskWorkspace.pickAssets;
  const openTaskAsset = taskWorkspace.openAsset;
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
    if (result.kind === 'note') {
      openWorkspaceTab('notes', result.id);
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
      setInterruptedRun(null); openWorkspaceTab('conversation', imported.id); closeSettings();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '导入会话失败。'); }
  };
  const resizeSidebar = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const shellLeft = event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0;
    setSidebarWidth(clampSidebarWidth(event.clientX - shellLeft));
  };
  const stopResizingSidebar = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setSidebarResizing(false);
  };
  const resizeSidebarWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    setSidebarWidth((current) => clampSidebarWidth(current + (event.key === 'ArrowRight' ? 20 : -20)));
  };

  const tabMenuTarget = tabContextMenu ? workspaceTabs.find((tab) => tab.id === tabContextMenu.tabId) : null;
  const tabMenuIndex = tabMenuTarget ? workspaceTabs.findIndex((tab) => tab.id === tabMenuTarget.id) : -1;
  const tabMenu = tabContextMenu && tabMenuTarget && typeof document !== 'undefined' ? createPortal(<div className="workspace-tab-menu" role="menu" style={{ left: tabContextMenu.x, top: tabContextMenu.y }} onClick={(event) => event.stopPropagation()}><button type="button" role="menuitem" onClick={() => closeWorkspaceTab(tabMenuTarget.id)}>关闭标签页</button><button type="button" role="menuitem" onClick={() => closeWorkspaceTabs(workspaceTabs.filter((item) => item.id !== tabMenuTarget.id).map((item) => item.id))}>关闭其他标签页</button><button type="button" role="menuitem" onClick={() => closeWorkspaceTabs(workspaceTabs.slice(tabMenuIndex + 1).map((item) => item.id))}>关闭右侧标签页</button><button type="button" role="menuitem" onClick={() => closeWorkspaceTabs(workspaceTabs.slice(0, tabMenuIndex).map((item) => item.id))}>关闭左侧标签页</button></div>, document.body) : null;
  const collapsedSidebarControl = !settingsMounted && sidebarCollapsed && typeof document !== 'undefined' ? createPortal(<SidebarExpandControl onExpand={() => setSidebarCollapsed(false)} />, document.body) : null;
  useEffect(() => { document.documentElement.dataset.windowFullscreen = windowFullscreen ? 'true' : 'false'; return () => { delete document.documentElement.dataset.windowFullscreen; }; }, [windowFullscreen]);
  return <main className={`app-shell ${sidebarCollapsed ? 'sidebar-is-collapsed' : ''} ${sidebarResizing ? 'sidebar-is-resizing' : ''} ${activeView === 'tasks' || activeView === 'notes' ? 'tasks-is-active' : ''} ${activeView === 'notes' ? 'notes-is-active' : ''} ${settingsMounted ? 'settings-is-active' : ''} ${settingsClosing ? 'settings-is-closing' : ''} ${profileMenuClosing || providerMenuClosing ? 'header-menu-closing' : ''}`} style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
    <Sidebar conversations={conversationItems} projects={conversationProjects} boards={taskBoards} providers={providers} newProviderId={newProviderId} activeId={activeConversation} activeProjectId={activeConversationProject} activeBoardId={activeTaskBoardId} activeNoteId={activeNoteId} notesBridge={activeBridge} notesRevision={notesRevision} onNotesChanged={notifyNotesChanged} mode={sidebarMode} settingsOpen={providerOpen} collapsed={sidebarCollapsed} appVersion={appInfo?.version} onSearch={() => setSearchOpen(true)} onSelect={(id) => { closeSettings(); selectConversation(id); }} onSelectProject={setActiveConversationProject} onSelectBoard={(id) => { closeSettings(); setRequestedOpenTaskId(null); openWorkspaceTab('tasks', id); }} onSelectNote={(id) => { closeSettings(); if (id) openWorkspaceTab('notes', id); }} onModeChange={(mode) => { setSidebarModeState(mode); closeSettings(); }} onNew={(projectId, providerId) => void createConversation(projectId, providerId)} onNewProviderChange={setNewProviderId} onRenameConversation={renameConversation} onMoveConversation={moveConversation} onArchiveConversation={archiveConversation} onPinConversation={pinConversation} onDeleteConversation={deleteConversation} onCreateProject={createConversationProject} onRenameProject={renameConversationProject} onDeleteProject={deleteConversationProject} onCreateBoard={createTaskBoard} onRenameBoard={renameTaskBoard} onDeleteBoard={deleteTaskBoard} onReorderBoard={reorderTaskBoard} onMoveTaskToBoard={async (id, boardId) => { await moveTaskToBoard(id, boardId); }} onSettings={() => openSettings()} onToggle={() => setSidebarCollapsed((current) => !current)} />
    {!settingsMounted && !sidebarCollapsed && <div className="sidebar-resize-handle" role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" aria-valuemin={MIN_SIDEBAR_WIDTH} aria-valuemax={MAX_SIDEBAR_WIDTH} aria-valuenow={sidebarWidth} tabIndex={0} title="拖拽调整侧栏宽度，双击恢复默认宽度" onDoubleClick={() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)} onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setSidebarResizing(true); }} onPointerMove={resizeSidebar} onPointerUp={stopResizingSidebar} onPointerCancel={stopResizingSidebar} onKeyDown={resizeSidebarWithKeyboard} />}
    <section className="workspace" aria-label="会话工作区">
      {!settingsMounted && <nav className="workspace-tabs" aria-label="已打开页面">{workspaceTabs.map((tab, index) => { const label = tab.type === 'conversation' ? (conversationItems.find((item) => item.id === tab.resourceId)?.title ?? '对话') : tab.type === 'tasks' ? (taskBoards.find((board) => board.id === tab.resourceId)?.name ?? '任务看板') : (noteTitles[tab.resourceId] ?? '笔记'); const menuOpen = tabContextMenu?.tabId === tab.id; return <div className={`workspace-tab ${tab.id === activeTabId ? 'is-active' : ''}`} key={tab.id} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setTabContextMenu({ tabId: tab.id, x: event.clientX, y: event.clientY }); }}><button type="button" className="workspace-tab-select" onClick={() => activateWorkspaceTab(tab)}>{tab.type === 'conversation' ? <MessageSquare size={14} /> : tab.type === 'tasks' ? <ListTodo size={14} /> : <NotebookPen size={14} />}<span>{label}</span></button>{workspaceTabs.length > 1 && <button type="button" className="workspace-tab-close" onClick={(event) => { event.stopPropagation(); closeWorkspaceTab(tab.id); }} aria-label={`关闭${label}`} title={`关闭${label}`}><X size={13} /></button>}{menuOpen && <div className="workspace-tab-menu" role="menu" style={{ left: tabContextMenu.x, top: tabContextMenu.y }} onClick={(event) => event.stopPropagation()}><button type="button" role="menuitem" onClick={() => closeWorkspaceTab(tab.id)} disabled={workspaceTabs.length <= 1}>关闭标签页</button><button type="button" role="menuitem" onClick={() => closeWorkspaceTabs(workspaceTabs.filter((item) => item.id !== tab.id).map((item) => item.id))} disabled={workspaceTabs.length <= 1}>关闭其他标签页</button><button type="button" role="menuitem" onClick={() => closeWorkspaceTabs(workspaceTabs.slice(index + 1).map((item) => item.id))} disabled={index === workspaceTabs.length - 1}>关闭右侧标签页</button><button type="button" role="menuitem" onClick={() => closeWorkspaceTabs(workspaceTabs.slice(0, index).map((item) => item.id))} disabled={index === 0}>关闭左侧标签页</button></div>}</div>; })}</nav>}
      {settingsMounted ? <SettingsWorkspace initialSection={settingsInitialSection} appInfo={appInfo} current={provider} providers={providers} browserUseConfig={browserUseConfig} computerUseConfig={computerUseConfig} theme={theme} onThemeChange={setTheme} onClose={closeSettings} onSaved={(saved) => { const boundProviderId = conversationItems.find((item) => item.id === activeConversation)?.providerId; if (!boundProviderId || boundProviderId === saved.id) setProvider(saved); }} onProvidersChange={setProviders} onBrowserUseChange={setBrowserUseConfig} onComputerUseChange={setComputerUseConfig} /> : activeView === 'tasks' ? <Suspense fallback={<div className="task-page-loading">正在打开任务看板...</div>}><TaskBoard boardId={activeTaskBoardId} boardName={taskBoards.find((board) => board.id === activeTaskBoardId)?.name ?? '任务'} boards={taskBoards} tasks={tasks} taskTypes={taskTypes} loading={tasksLoading} headerControl={sidebarCollapsed ? <SidebarExpandControl onExpand={() => setSidebarCollapsed(false)} /> : null} requestedOpenTaskId={requestedOpenTaskId} onOpenTaskHandled={() => setRequestedOpenTaskId(null)} taskActionRequest={taskActionRequest} onTaskActionHandled={() => setTaskActionRequest(null)} sourceConversations={conversationItems} onOpenConversation={selectConversation} onCreate={createTask} onUpdate={updateTask} onDelete={deleteTask} onReorder={reorderTask} onMoveToBoard={moveTaskToBoard} onCopyToBoard={copyTaskToBoard} onCreateType={createTaskType} onRenameType={renameTaskType} onDeleteType={deleteTaskType} onImportAsset={importTaskAsset} onPickAssets={pickTaskAssets} onOpenAsset={openTaskAsset} onRunAi={(prompt, signal) => runAiForBoard(taskBoards.find((board) => board.id === activeTaskBoardId)?.name ?? '任务', tasks, prompt, signal)} /></Suspense> : activeView === 'notes' ? <Suspense fallback={<div className="task-page-loading">正在打开笔记...</div>}><NotesWorkspace bridge={activeBridge} initialNoteId={activeNoteId} refreshKey={notesRevision} showNavigation={false} onNotesChanged={notifyNotesChanged} onActiveNoteChange={setActiveNoteId} onRunAi={(note, action, instruction, signal) => runAiForNote(note, action, instruction, signal)} onCreateTask={(note) => void createTaskFromNote(note)} onOpenTask={(boardId, taskId) => { closeSettings(); openWorkspaceTab('tasks', boardId); setRequestedOpenTaskId(taskId); }} onImportAsset={importTaskAsset} onPickAssets={pickTaskAssets} onOpenAsset={openTaskAsset} /></Suspense> : <>
      <header className="workspace-header">{sidebarCollapsed && <SidebarExpandControl onExpand={() => setSidebarCollapsed(false)} />}<div className="conversation-identity"><div className="identity-mark"><ThinkingOrb state={isThinking ? 'working' : 'breathing'} size={20} theme="dark" /></div><div><h1>{activeTitle}</h1><span className="identity-meta">个人工作区 <span className="meta-separator">·</span> 会话 ID <button type="button" className="conversation-id-button" onClick={() => void copyConversationId()} title={`复制完整会话 ID：${activeConversation}`} aria-label={`复制会话 ID：${activeConversation}`}>{copiedConversationId ? '已复制' : shortId(activeConversation)}</button><span className="meta-separator">·</span><span className="conversation-profile-picker"><span>Profile</span><span className="profile-picker-control"><button type="button" className="profile-picker-trigger" aria-haspopup="listbox" aria-expanded={profileMenuOpen} aria-label={`当前会话 Profile：${activeProfile.name}`} title={activeProfile.description} onClick={() => setProfileMenuOpen((current) => !current)}><span>{activeProfile.name}</span><ChevronDown size={13} aria-hidden="true" /></button>{profileMenuOpen && <span className="profile-picker-menu" role="listbox" aria-label="选择会话 Profile">{AGENT_PROFILES.map((item) => <button type="button" role="option" aria-selected={item.id === activeProfileId} className={item.id === activeProfileId ? 'is-selected' : ''} key={item.id} onClick={() => { setProfileMenuOpen(false); void selectConversationProfile(item.id); }}><span><strong>{item.name}</strong><small>{item.description}</small></span>{item.id === activeProfileId && <span className="profile-picker-check" aria-hidden="true">✓</span>}</button>)}</span>}</span></span>{providers.length > 0 && <><span className="meta-separator">·</span><span className="conversation-provider-picker"><span>Provider</span><span className="provider-picker-control"><button type="button" className="provider-picker-trigger" aria-haspopup="listbox" aria-expanded={providerMenuOpen} aria-label={`当前会话 Provider：${activeProvider?.displayName ?? '未选择'}`} title={activeProvider ? `${activeProvider.displayName} · ${activeProvider.model}` : '选择 Provider'} onClick={() => setProviderMenuOpen((current) => !current)}><span>{(activeProvider?.displayName ?? activeProviderId) || '未选择'}</span><ChevronDown size={13} aria-hidden="true" /></button>{providerMenuOpen && <span className="provider-picker-menu" role="listbox" aria-label="选择会话 Provider">{providers.map((item) => <button type="button" role="option" aria-selected={item.id === activeProviderId} className={`${item.id === activeProviderId ? 'is-selected' : ''} ${item.hasApiKey ? '' : 'is-disabled'}`} key={item.id} disabled={!item.hasApiKey} onClick={() => { setProviderMenuOpen(false); void selectConversationProvider(item.id); }}><span><strong>{item.displayName}</strong><small>{item.protocol} · {item.model}{item.hasApiKey ? '' : ' · 未配置 Key'}</small></span>{item.id === activeProviderId && <span className="profile-picker-check" aria-hidden="true">✓</span>}</button>)}</span>}</span></span></>}</span></div></div><div className="header-actions"><button type="button" className="header-icon-button" onClick={() => void importConversation()} aria-label="导入会话" title="导入会话"><Upload size={15} /></button><button type="button" className="header-icon-button" onClick={() => void exportActiveConversation()} aria-label="导出会话" title="导出会话"><Download size={15} /></button><ContextWindowStatus usage={latestCompletedRun?.usage ?? null} refreshing={Boolean(isThinking)} /><div className="header-status" aria-live="polite"><span className={`status-dot ${isThinking ? 'is-active' : ''}`} />{isThinking ? '处理中' : visibleError ? '需要处理' : '就绪'}</div></div></header>
      {visibleError && <div className="inline-error" role="alert">{visibleError}<button type="button" onClick={() => { setError(null); taskWorkspace.clearError(); settings.clearError(); }} aria-label="关闭错误提示">×</button></div>}
      <div className={`conversation-body ${conversationIsEmpty ? 'is-empty' : ''}`}>
        {conversationIsEmpty ? <ConversationStart composer={<Composer variant="start" prefill={composerPrefill} busy={Boolean(isThinking)} attachments={attachments} reasoningSelection={reasoningSelection} onReasoningSelectionChange={(selection) => { setReasoningSelection(selection); void activeBridge?.reasoning.save(activeConversation, selection); }} permissionMode={permissionMode} onPermissionModeChange={selectPermissionMode} onAttach={pickAttachments} onRemoveAttachment={removeAttachment} onSubmit={submitMessage} onCancel={cancelRun} />} onSelectPrompt={(value) => setComposerPrefill((current) => ({ id: (current?.id ?? 0) + 1, value }))} /> : <>
          <Transcript messages={activeMessages} isThinking={isThinking} activities={activeActivities} runs={conversationRuns[activeConversation] ?? []} latestUsage={latestUsage} recoveryNotice={interruptedRun ? { message: interruptedRun.error ?? '应用重启时运行被中断。', onRetry: interruptedMessage ? () => void retryLastTurn(false, interruptedRun.inputMessageId ?? undefined) : undefined, busy: retryingRun } : null} requestedMessageId={requestedMessageId} onRequestedMessageHandled={() => setRequestedMessageId(null)} requestedRunId={requestedRunId} onRequestedRunHandled={() => setRequestedRunId(null)} onCreateTask={(message) => void createTaskFromMessage(message)} onBranch={(message) => void branchConversation(message)} onEditLastUser={(message) => { setRetryDraft({ messageId: message.id, content: message.content }); setComposerPrefill((current) => ({ id: (current?.id ?? 0) + 1, value: message.content })); }} onRegenerate={() => void retryLastTurn()} onOpenTask={(boardId, taskId) => { closeSettings(); setActiveTaskBoardId(boardId); setActiveView('tasks'); setRequestedOpenTaskId(taskId); }} />
          <Composer editing={Boolean(retryDraft)} prefill={composerPrefill} onCancelEdit={() => { setRetryDraft(null); setComposerPrefill(null); }} busy={Boolean(isThinking) || retryingRun} attachments={attachments} reasoningSelection={reasoningSelection} onReasoningSelectionChange={(selection) => { setReasoningSelection(selection); void activeBridge?.reasoning.save(activeConversation, selection); }} permissionMode={permissionMode} onPermissionModeChange={selectPermissionMode} onAttach={pickAttachments} onRemoveAttachment={removeAttachment} onSubmit={submitMessage} onCancel={cancelRun} />
        </>}
      </div>
      </>}
    </section>
    {searchOpen && <GlobalSearch onQuery={(query) => activeBridge?.search.query(query) ?? Promise.resolve([])} onOpen={openSearchResult} onClose={() => setSearchOpen(false)} onNewConversation={() => { closeSettings(); void createConversation(); }} onOpenTasks={() => { closeSettings(); setActiveView('tasks'); }} />}
    {permissionConfirmationOpen && <div className="approval-backdrop permission-confirm-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget && !permissionSaving) setPermissionConfirmationOpen(false); }}><section className="approval-dialog permission-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="permission-confirm-title" aria-describedby="permission-confirm-description"><div className="approval-dialog-header"><span>完全访问</span><h2 id="permission-confirm-title">为当前会话启用完全访问？</h2><p id="permission-confirm-description">玉衡将不再询问文件、Shell 与外部操作；基础隔离、输入校验和安全审计仍保持启用。此设置会在退出应用后失效。</p></div><div className="approval-actions"><button type="button" className="secondary-action" onClick={() => setPermissionConfirmationOpen(false)} disabled={permissionSaving}>取消</button><button type="button" className="danger-action" autoFocus onClick={() => void savePermissionMode('full_session')} disabled={permissionSaving}>{permissionSaving ? '启用中…' : '为当前会话启用'}</button></div></section></div>}
    {pendingApproval && <div className={`approval-backdrop ${approvalClosing ? 'is-closing' : ''}`} role="presentation"><section className="approval-dialog" role="alertdialog" aria-modal="true" aria-labelledby="approval-title" aria-describedby="approval-description" data-approval-id={pendingApproval.approvalId} tabIndex={-1}><div className="approval-dialog-header"><span>Agent Runtime</span><h2 id="approval-title">允许这次工具操作？</h2><p id="approval-description">玉衡准备执行 <code>{pendingApproval.toolName}</code></p></div>{pendingApproval.input && <pre>{pendingApproval.input}</pre>}<div className="approval-actions"><button type="button" className="secondary-action" onClick={() => void resolveApproval(false)} disabled={approvalClosing}>拒绝</button><button type="button" className="send-button" autoFocus onClick={() => void resolveApproval(true)} disabled={approvalClosing}>允许一次</button></div></section></div>}
    {tabMenu}
    {collapsedSidebarControl}
  </main>;
}
