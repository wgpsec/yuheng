import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_AGENT_PROFILE_ID, type AgentProfileId, type DesktopBridge, type Message, type ProviderConfig, type ReasoningSelection, type RunEvent, type RunSummary, type ToolPermissionMode } from '../../contracts/desktop-bridge';
import type { Conversation as SidebarConversation } from './workspace/sidebar';
import type { ToolActivity, TranscriptMessage } from './workspace/transcript';

type ConversationProject = { id: string; name: string; position: number };

const fallbackItems: SidebarConversation[] = [
  { id: 'inbox', projectId: 'personal', title: '收件箱', time: '现在', pinned: false },
  { id: 'weekly-plan', projectId: 'personal', title: '本周计划', time: '昨天', pinned: false },
  { id: 'research', projectId: 'personal', title: '资料整理', time: '周一', pinned: false },
];
const fallbackMessages: Record<string, TranscriptMessage[]> = {
  inbox: [],
  'weekly-plan': [{ id: 'weekly-1', role: 'user', content: '帮我整理一下本周最重要的三件事。', time: '昨天 18:42' }, { id: 'weekly-2', role: 'assistant', content: '可以。先从已经确认的事项开始：项目发布、供应商跟进和周五的复盘。', time: '昨天 18:43' }],
  research: [{ id: 'research-1', role: 'user', content: '把上次收集的资料按主题分一下。', time: '周一 10:16' }, { id: 'research-2', role: 'assistant', content: '我先按“产品、技术、待确认”三个主题归类，待确认的内容单独列出。', time: '周一 10:17' }],
};

const displayMessage = (message: Message): TranscriptMessage => ({
  ...message,
  time: new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
});

const sortConversations = (items: SidebarConversation[]): SidebarConversation[] => [...items].sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) || (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''));

export const isCurrentConversationRequest = (requestedId: string, requestVersion: number, activeId: string, currentVersion: number): boolean => requestedId === activeId && requestVersion === currentVersion;
export const acceptsRunEventScope = (activeRunId: string | undefined, eventRunId: string): boolean => !activeRunId || activeRunId === eventRunId;

type Options = {
  initialConversation?: string;
  providers: ProviderConfig[];
  provider: ProviderConfig | null;
  onOpenSettings: () => void;
  onError?: (message: string | null) => void;
  onApprovalRequired?: (event: Extract<RunEvent, { type: 'approval_required' }>) => void;
  onApprovalResolved?: (approvalId: string) => void;
};

export function useConversationWorkspace(bridge: DesktopBridge | undefined, options: Options) {
  const [items, setItems] = useState<SidebarConversation[]>(fallbackItems);
  const [projects, setProjects] = useState<ConversationProject[]>([{ id: 'personal', name: '个人事务', position: 0 }]);
  const [activeId, setActiveIdState] = useState(options.initialConversation ?? 'inbox');
  const [activeProjectId, setActiveProjectId] = useState('personal');
  const [activeProfileId, setActiveProfileId] = useState<AgentProfileId>(DEFAULT_AGENT_PROFILE_ID);
  const [messages, setMessages] = useState<Record<string, TranscriptMessage[]>>(fallbackMessages);
  const [runs, setRuns] = useState<Record<string, RunSummary[]>>({});
  const [activities, setActivities] = useState<Record<string, ToolActivity[]>>({});
  const [activeRunIds, setActiveRunIds] = useState<Record<string, string>>({});
  const [interruptedRun, setInterruptedRun] = useState<RunSummary | null>(null);
  const [reasoningSelection, setReasoningSelection] = useState<ReasoningSelection>('default');
  const [permissionMode, setPermissionMode] = useState<ToolPermissionMode>('smart');
  const [error, setError] = useState<string | null>(null);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(!bridge);
  const activeRef = useRef(activeId);
  const activeRunIdsRef = useRef<Record<string, string>>({});
  const loadVersionRef = useRef(0);
  const optionsRef = useRef(options);
  activeRef.current = activeId;
  activeRunIdsRef.current = activeRunIds;
  optionsRef.current = options;

  const reportError = useCallback((reason: unknown, fallback: string) => {
    const message = reason instanceof Error ? reason.message : fallback;
    setError(message);
    optionsRef.current.onError?.(message);
  }, []);
  const clearError = useCallback(() => { setError(null); optionsRef.current.onError?.(null); }, []);

  useEffect(() => {
    if (!bridge) return;
    let mounted = true;
    void Promise.all([bridge.conversations.list(true), bridge.conversations.projects.list()]).then(([nextItems, nextProjects]) => {
      if (!mounted) return;
      const sorted = sortConversations(nextItems);
      setItems(sorted); setProjects(nextProjects); setWorkspaceLoaded(true);
      const initial = sorted.find((item) => !item.archived) ?? sorted[0];
      if (initial) {
        setActiveIdState((current) => current === 'inbox' ? initial.id : current);
        setActiveProjectId(initial.projectId);
        setActiveProfileId(initial.profileId ?? DEFAULT_AGENT_PROFILE_ID);
      }
    }).catch((reason) => { if (mounted) { setWorkspaceLoaded(true); reportError(reason, '加载本地数据失败。'); } });
    return () => { mounted = false; };
  }, [bridge, reportError]);

  useEffect(() => {
    if (!bridge) return;
    const conversationId = activeId;
    const version = ++loadVersionRef.current;
    let mounted = true;
    void Promise.all([bridge.conversations.messages(conversationId), bridge.runs.list(conversationId)]).then(([nextMessages, nextRuns]) => {
      if (!mounted || !isCurrentConversationRequest(conversationId, version, activeRef.current, loadVersionRef.current)) return;
      setMessages((current) => ({ ...current, [conversationId]: nextMessages.map(displayMessage) }));
      setRuns((current) => ({ ...current, [conversationId]: nextRuns }));
      const interrupted = nextRuns.find((run) => run.status === 'interrupted');
      setInterruptedRun(interrupted ?? null);
      setActivities((current) => ({ ...current, [conversationId]: nextRuns.flatMap((run) => run.activities).map((activity) => ({ id: activity.id, toolName: activity.toolName, status: activity.status, input: activity.input ?? undefined, output: activity.output ?? undefined, startedAt: activity.startedAt, finishedAt: activity.finishedAt, artifacts: activity.artifacts })) }));
    }).catch((reason) => { if (mounted && isCurrentConversationRequest(conversationId, version, activeRef.current, loadVersionRef.current)) reportError(reason, '加载会话失败。'); });
    return () => { mounted = false; loadVersionRef.current += 1; };
  }, [activeId, bridge, reportError]);

  useEffect(() => {
    if (!bridge) return;
    return bridge.runs.onEvent((event: RunEvent) => {
      if (event.type === 'approval_required') { optionsRef.current.onApprovalRequired?.(event); return; }
      if (event.type === 'approval_resolved') { optionsRef.current.onApprovalResolved?.(event.approvalId); return; }
      if (event.type === 'accepted') {
        const next = { ...activeRunIdsRef.current, [event.conversationId]: event.runId };
        activeRunIdsRef.current = next;
        setActiveRunIds(next);
        return;
      }
      if (!acceptsRunEventScope(activeRunIdsRef.current[event.conversationId], event.runId)) return;
      if (event.type === 'tool_start') {
        setActivities((current) => ({ ...current, [event.conversationId]: [...(current[event.conversationId] ?? []), { id: event.toolCallId, toolName: event.toolName, status: 'running', input: event.input, startedAt: new Date().toISOString() }] })); return;
      }
      if (event.type === 'tool_end') {
        setActivities((current) => ({ ...current, [event.conversationId]: (current[event.conversationId] ?? []).map((activity) => activity.id === event.toolCallId ? { ...activity, toolName: event.toolName, status: event.isError ? 'failed' : 'completed', output: event.output, finishedAt: new Date().toISOString(), artifacts: event.artifacts } : activity) })); return;
      }
      if (event.type === 'delta') {
        setMessages((current) => {
          const existing = current[event.conversationId] ?? [];
          const index = existing.findIndex((message) => message.id === event.messageId);
          if (index < 0) return { ...current, [event.conversationId]: [...existing, { id: event.messageId, role: 'assistant', content: event.delta, time: '刚刚', createdAt: event.createdAt }] };
          const next = [...existing]; next[index] = { ...next[index], content: `${next[index].content}${event.delta}` }; return { ...current, [event.conversationId]: next };
        });
      } else if (event.type === 'failed' || event.type === 'cancelled') {
        setActivities((current) => ({ ...current, [event.conversationId]: (current[event.conversationId] ?? []).map((activity) => activity.status === 'running' ? { ...activity, status: event.type === 'failed' ? 'failed' : 'cancelled' } : activity) }));
        if (event.conversationId === activeRef.current && event.type === 'failed') reportError(event.error, '运行失败。');
      }
      if (event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled') {
        if (activeRunIdsRef.current[event.conversationId] === event.runId) {
          const next = { ...activeRunIdsRef.current };
          delete next[event.conversationId];
          activeRunIdsRef.current = next;
          setActiveRunIds(next);
        }
        void bridge.runs.list(event.conversationId).then((next) => setRuns((current) => ({ ...current, [event.conversationId]: next }))).catch(() => undefined);
      }
    });
  }, [bridge, reportError]);

  useEffect(() => {
    if (!bridge) return;
    let mounted = true;
    void bridge.reasoning.get(activeId).then((selection) => { if (mounted && activeRef.current === activeId) setReasoningSelection(selection); }).catch((reason) => { if (mounted) reportError(reason, '加载会话推理设置失败。'); });
    void bridge.permissions.get(activeId).then((mode) => { if (mounted && activeRef.current === activeId) setPermissionMode(mode); }).catch((reason) => { if (mounted) reportError(reason, '加载会话权限设置失败。'); });
    return () => { mounted = false; };
  }, [activeId, bridge, reportError]);

  const select = useCallback((id: string) => {
    loadVersionRef.current += 1; activeRef.current = id; setActiveIdState(id);
    const item = items.find((conversation) => conversation.id === id);
    if (item) { setActiveProjectId(item.projectId); setActiveProfileId(item.profileId ?? DEFAULT_AGENT_PROFILE_ID); }
    setInterruptedRun(null); clearError();
  }, [clearError, items]);
  const refresh = useCallback(async () => { if (!bridge) return []; const next = sortConversations(await bridge.conversations.list(true)); setItems(next); return next; }, [bridge]);
  const activeMessages = messages[activeId] ?? [];
  const activeActivities = activities[activeId] ?? [];
  const conversationRuns = runs[activeId] ?? [];
  const activeRun = activeRunIds[activeId] ? { id: activeRunIds[activeId], conversationId: activeId } : null;
  const isThinking = Boolean(activeRun);
  const activeTitle = useMemo(() => items.find((item) => item.id === activeId)?.title ?? '新会话', [activeId, items]);
  return { items, setItems, projects, setProjects, workspaceLoaded, activeId, setActiveId: select, activeProjectId, setActiveProjectId, activeProfileId, setActiveProfileId, messages, setMessages, runs, setRuns, activities, setActivities, activeRun, interruptedRun, setInterruptedRun, reasoningSelection, setReasoningSelection, permissionMode, setPermissionMode, error, clearError, activeMessages, activeActivities, conversationRuns, isThinking, activeTitle, refresh };
}
