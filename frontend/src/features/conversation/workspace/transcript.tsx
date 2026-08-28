import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ThinkingOrb } from 'thinking-orbs';
import { Maximize2, Pencil, RefreshCw, X } from 'lucide-react';
import type { DesktopBridge, RunSummary } from '../../../contracts/desktop-bridge';

export type TranscriptAttachment = { id: string; name: string; size: number };
export type TranscriptMessage = { id: string; role: 'user' | 'assistant'; content: string; time: string; createdAt?: string; attachments?: TranscriptAttachment[] };
export type RecoveryNotice = { message: string; onRetry?: () => void; busy?: boolean };
export type ToolArtifact = { id: string; kind: 'browser_screenshot' | 'computer_screenshot'; mimeType: string; size: number; url: string };
export type ToolActivity = { id: string; toolName: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; input?: string; output?: string; startedAt?: string; finishedAt?: string | null; artifacts?: ToolArtifact[] };
export type RunUsageView = { inputTokens: number; outputTokens: number; totalTokens: number; contextTokens: number | null; contextWindow: number; contextPercent: number | null; durationMs: number };

export function taskIdentityFromToolActivity(activity: Pick<ToolActivity, 'toolName' | 'output'>): { boardId: string; taskId: string } | null {
  if (activity.toolName !== 'task_create' && activity.toolName !== 'task_update' || !activity.output) return null;
  try {
    const value: unknown = JSON.parse(activity.output);
    if (!value || typeof value !== 'object' || !('task' in value)) return null;
    const task = (value as { task?: unknown }).task;
    if (!task || typeof task !== 'object') return null;
    const { id, boardId } = task as { id?: unknown; boardId?: unknown };
    return typeof id === 'string' && id.length > 0 && typeof boardId === 'string' && boardId.length > 0 ? { taskId: id, boardId } : null;
  } catch {
    return null;
  }
}

function toolLabel(toolName: string): string {
  return ({ bash: '终端命令', read: '读取文件', write: '写入文件', edit: '编辑文件', browser_navigate: '打开网页', browser_get_state: '读取页面', browser_screenshot: '页面截图', browser_click: '点击网页', browser_type: '填写网页', browser_scroll: '滚动页面', browser_go_back: '返回上页', browser_list_tabs: '查看标签页', browser_switch_tab: '切换标签页', browser_close_tab: '关闭标签页', find_roots: '查找窗口', observe_ui: '观察界面', search_ui: '搜索界面', expand_ui: '展开界面', inspect_ui: '检查控件', act_ui: '操作界面', read_text: '读取界面文本', wait_for: '等待界面变化', launch_browser: '启动浏览器', navigate_browser: '导航浏览器', evaluate_browser: '执行浏览器脚本' } as Record<string, string>)[toolName] ?? toolName;
}

function ToolActivityCard({ activity, onOpenTask }: { activity: ToolActivity; onOpenTask?: (boardId: string, taskId: string) => void }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewClosing, setPreviewClosing] = useState(false);
  const previewCloseTimer = useRef<number | null>(null);
  const [failedArtifacts, setFailedArtifacts] = useState<Set<string>>(() => new Set());
  const closePreview = () => {
    if (!previewUrl) return;
    setPreviewClosing(true);
    if (previewCloseTimer.current !== null) window.clearTimeout(previewCloseTimer.current);
    previewCloseTimer.current = window.setTimeout(() => { setPreviewUrl(null); setPreviewClosing(false); previewCloseTimer.current = null; }, 170);
  };
  useEffect(() => () => { if (previewCloseTimer.current !== null) window.clearTimeout(previewCloseTimer.current); }, []);
  const statusLabel = activity.status === 'running' ? '执行中' : activity.status === 'completed' ? '已完成' : activity.status === 'failed' ? '失败' : '已取消';
  const taskIdentity = activity.status === 'completed' ? taskIdentityFromToolActivity(activity) : null;
  return <article className={`tool-activity is-${activity.status}`}>
    <div className="tool-activity-summary"><span className="tool-activity-indicator" /><strong>{toolLabel(activity.toolName)}</strong><code>{activity.toolName}</code><span className="tool-activity-status">{statusLabel}</span>{taskIdentity && onOpenTask && <button type="button" className="tool-activity-task-link" onClick={() => onOpenTask(taskIdentity.boardId, taskIdentity.taskId)}>打开任务</button>}</div>
    {activity.artifacts?.map((artifact) => <div className="tool-artifact" key={artifact.id}>
      {failedArtifacts.has(artifact.id)
        ? <div className="tool-artifact-unavailable" role="status">截图文件不可用或已过期</div>
        : <button type="button" className="tool-artifact-preview" onClick={() => { if (previewCloseTimer.current !== null) window.clearTimeout(previewCloseTimer.current); setPreviewClosing(false); setPreviewUrl(artifact.url); }} aria-label="放大查看工具截图">
          <img src={artifact.url} alt={artifact.kind === 'computer_screenshot' ? 'Computer Use 桌面截图' : 'Browser Use 页面截图'} loading="lazy" onError={() => setFailedArtifacts((current) => new Set(current).add(artifact.id))} />
          <span><Maximize2 size={14} />{Math.max(1, Math.round(artifact.size / 1024))} KB</span>
        </button>}
    </div>)}
    {(activity.input || activity.output) && <details open={activity.status === 'running'}><summary>查看调用详情</summary>{activity.input && <div><span className="tool-activity-label">输入</span><pre>{activity.input}</pre></div>}{activity.output && <div><span className="tool-activity-label">结果</span><pre>{activity.output}</pre></div>}</details>}
    {previewUrl && <div className={`tool-artifact-lightbox ${previewClosing ? 'is-closing' : ''}`} role="presentation" onClick={closePreview}><section role="dialog" aria-modal="true" aria-label="工具截图预览" onClick={(event) => event.stopPropagation()}><button type="button" onClick={closePreview} aria-label="关闭截图预览" title="关闭"><X size={18} /></button><img src={previewUrl} alt="工具截图大图" /></section></div>}
  </article>;
}

function CodeBlock({ language, children }: { language?: string; children: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return <div className="code-block"><div className="code-block-header"><span>{language || '代码'}</span><button type="button" onClick={() => void copy()}>{copied ? '已复制' : '复制'}</button></div><pre><code>{children}</code></pre></div>;
}

function AssistantContent({ content }: { content: string }) {
  const openExternal = (href: string) => {
    try {
      const url = new URL(href, window.location.href);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
      const bridge = (window as Window & { desktopBridge?: DesktopBridge }).desktopBridge;
      if (bridge) void bridge.app.openExternal(url.toString());
    } catch { /* Invalid links remain inert. */ }
  };
  return <div className="message-markdown"><Markdown remarkPlugins={[remarkGfm]} components={{
    a({ href, children }) {
      if (!href) return <>{children}</>;
      return <a href={href} target="_blank" rel="noreferrer noopener" onClick={(event) => { event.preventDefault(); openExternal(href); }}>{children}</a>;
    },
    pre({ children }) { return <>{children}</>; },
    code({ className, children }) {
      const value = String(children).replace(/\n$/, '');
      const language = className?.match(/language-(\w+)/)?.[1];
      if (!className && !value.includes('\n')) return <code>{children}</code>;
      return <CodeBlock language={language}>{value}</CodeBlock>;
    },
  }}>{content}</Markdown></div>;
}

function messageTimestamps(messages: TranscriptMessage[]): number[] {
  const timestamps = messages.map((message) => {
    if (!message.createdAt) return null;
    const timestamp = Date.parse(message.createdAt);
    return Number.isFinite(timestamp) ? timestamp : null;
  });
  let start = 0;
  while (start < timestamps.length) {
    if (timestamps[start] !== null) {
      start += 1;
      continue;
    }
    let end = start;
    while (end < timestamps.length && timestamps[end] === null) end += 1;
    const previous = start > 0 ? timestamps[start - 1] : null;
    const next = end < timestamps.length ? timestamps[end] : null;
    const count = end - start;
    for (let offset = 0; offset < count; offset += 1) {
      if (previous !== null && next !== null) timestamps[start + offset] = previous + ((next - previous) * (offset + 1)) / (count + 1);
      else if (previous !== null) timestamps[start + offset] = previous + offset + 1;
      else if (next !== null) timestamps[start + offset] = next - count + offset;
      else timestamps[start + offset] = start + offset;
    }
    start = end;
  }
  return timestamps as number[];
}

function formatRunDuration(run: RunSummary): string | null {
  const startedAt = Date.parse(run.startedAt);
  if (!Number.isFinite(startedAt)) return null;
  if (run.status === 'running') return '处理中';
  if (!run.finishedAt) return null;
  const finishedAt = Date.parse(run.finishedAt);
  if (!Number.isFinite(finishedAt)) return null;
  const durationMs = Math.max(0, finishedAt - startedAt);
  if (durationMs < 1000) return `用时 ${(durationMs / 1000).toFixed(1)} 秒`;
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `用时 ${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `用时 ${minutes} 分${remainder > 0 ? ` ${remainder} 秒` : ''}`;
}

function runStatusLabel(run: RunSummary): string | null {
  if (run.status === 'failed') return ' · 失败';
  if (run.status === 'cancelled') return ' · 已取消';
  if (run.status === 'interrupted') return ' · 已中断';
  return null;
}

function RunDuration({ run, pending }: { run?: RunSummary; pending: boolean }) {
  if (!run && !pending) return null;
  const duration = run ? formatRunDuration(run) : '处理中';
  const status = run ? runStatusLabel(run) : null;
  if (!duration && !status) return null;
  return <div className="message-duration" aria-label="本轮运行耗时">{duration ?? '耗时未知'}{status && <span>{status}</span>}</div>;
}

export function Transcript({ messages, isThinking, activities = [], runs = [], recoveryNotice, latestUsage, requestedMessageId, onRequestedMessageHandled, onOpenTask, onEditLastUser, onRegenerate }: { messages: TranscriptMessage[]; isThinking: boolean; activities?: ToolActivity[]; runs?: RunSummary[]; recoveryNotice?: RecoveryNotice | null; latestUsage?: RunUsageView | null; requestedMessageId?: string | null; onRequestedMessageHandled?: () => void; onOpenTask?: (boardId: string, taskId: string) => void; onEditLastUser?: (message: TranscriptMessage) => void; onRegenerate?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const timestamps = messageTimestamps(messages);
  const lastUserId = [...messages].reverse().find((message) => message.role === 'user')?.id;
  const lastAssistantId = [...messages].reverse().find((message) => message.role === 'assistant')?.id;
  const runByInputMessageId = new Map<string, RunSummary>();
  for (const run of runs) {
    if (!run.inputMessageId) continue;
    const existing = runByInputMessageId.get(run.inputMessageId);
    if (!existing || Date.parse(run.startedAt) >= Date.parse(existing.startedAt)) runByInputMessageId.set(run.inputMessageId, run);
  }
  const durationMessageIds = new Set<string>();
  const durationRunByMessageId = new Map<string, RunSummary>();
  messages.forEach((message, index) => {
    if (message.role !== 'user') return;
    const run = runByInputMessageId.get(message.id);
    if (!run) return;
    const nextUserIndex = messages.findIndex((candidate, candidateIndex) => candidateIndex > index && candidate.role === 'user');
    const assistant = messages.slice(index + 1, nextUserIndex < 0 ? messages.length : nextUserIndex).find((candidate) => candidate.role === 'assistant');
    const targetId = assistant?.id ?? message.id;
    durationMessageIds.add(targetId);
    durationRunByMessageId.set(targetId, run);
  });
  const timeline = [
    ...messages.map((message, index) => ({ kind: 'message' as const, value: message, timestamp: timestamps[index], order: index })),
    ...activities.map((activity, index) => ({ kind: 'activity' as const, value: activity, timestamp: activity.startedAt ? Date.parse(activity.startedAt) : Number.MAX_SAFE_INTEGER, order: messages.length + index })),
  ].sort((left, right) => left.timestamp - right.timestamp || left.order - right.order);
  useEffect(() => {
    if (!requestedMessageId) return;
    const target = Array.from(containerRef.current?.querySelectorAll<HTMLElement>('[data-message-id]') ?? []).find((element) => element.dataset.messageId === requestedMessageId);
    if (!target) return;
    setHighlightedMessageId(requestedMessageId);
    window.requestAnimationFrame(() => target.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    onRequestedMessageHandled?.();
  }, [messages, onRequestedMessageHandled, requestedMessageId]);
  useEffect(() => {
    if (!highlightedMessageId) return;
    const timer = window.setTimeout(() => setHighlightedMessageId(null), 1600);
    return () => window.clearTimeout(timer);
  }, [highlightedMessageId]);
  return (
    <div className="transcript" aria-live="polite" ref={containerRef}>
      {timeline.length > 0 && <div className="message-list">
        {timeline.map((item, index) => {
          const activityGroup = item.kind === 'activity' && (index === 0 || timeline[index - 1].kind !== 'activity')
            ? timeline.slice(index).reduce<ToolActivity[]>((group, candidate) => candidate.kind === 'activity' ? [...group, candidate.value] : group, [])
            : null;
          if (item.kind === 'activity' && !activityGroup) return null;
          return <div key={`${item.kind}-${item.value.id}`}>
          {item.kind === 'activity' ? (activityGroup ? <details className="tool-activity-group"><summary><span>执行记录</span><span>{activityGroup.length} 项</span></summary><div className="tool-activity-list">{activityGroup.map((activity) => <ToolActivityCard key={activity.id} activity={activity} onOpenTask={onOpenTask} />)}</div></details> : null) : <article data-message-id={item.value.id} className={['message', item.value.role, highlightedMessageId === item.value.id ? 'is-search-target' : ''].filter(Boolean).join(' ')}>
            <div className="message-avatar">{item.value.role === 'assistant' ? <ThinkingOrb state="breathing" size={20} theme="dark" /> : '你'}</div>
            <div className="message-body"><div className="message-meta"><strong>{item.value.role === 'assistant' ? '玉衡' : '你'}</strong><time>{item.value.time}</time></div>{item.value.role === 'assistant' ? <AssistantContent content={item.value.content} /> : <p>{item.value.content}</p>}{item.value.attachments && item.value.attachments.length > 0 && <div className="message-attachments" aria-label="消息附件">{item.value.attachments.map((attachment) => <span className="message-attachment" key={attachment.id}><span className="message-attachment-icon">↗</span><span className="message-attachment-name">{attachment.name}</span><small>{Math.max(1, Math.round(attachment.size / 1024))} KB</small></span>)}</div>}<RunDuration run={durationMessageIds.has(item.value.id) ? durationRunByMessageId.get(item.value.id) : undefined} pending={isThinking && item.value.id === lastUserId && !durationMessageIds.has(item.value.id)} />{!isThinking && (item.value.id === lastUserId || item.value.id === lastAssistantId) && <div className="message-actions">{item.value.role === 'assistant' && item.value.id === lastAssistantId && onRegenerate && <button type="button" onClick={onRegenerate}><RefreshCw size={13} />重新生成</button>}{item.value.role === 'user' && item.value.id === lastUserId && lastAssistantId !== messages.at(-1)?.id && onRegenerate && <button type="button" onClick={onRegenerate}><RefreshCw size={13} />重新生成</button>}{item.value.role === 'user' && item.value.id === lastUserId && onEditLastUser && <button type="button" onClick={() => onEditLastUser(item.value)}><Pencil size={13} />编辑后重发</button>}</div>}</div>
          </article>}
        </div>;
        })}
      </div>}
      {latestUsage && <div className="run-usage" aria-label="最近一次运行用量"><span>输入 {latestUsage.inputTokens.toLocaleString()} tokens</span><span>输出 {latestUsage.outputTokens.toLocaleString()}</span></div>}
      {recoveryNotice && <div className="recovery-notice" role="status"><div><strong>上次运行已中断</strong><p>{recoveryNotice.message}</p></div>{recoveryNotice.onRetry && <button type="button" onClick={recoveryNotice.onRetry} disabled={recoveryNotice.busy}>{recoveryNotice.busy ? '恢复中…' : '恢复运行'}</button>}</div>}
      {isThinking && (
        <div className="assistant-message pending-message">
          <ThinkingOrb state="working" size={20} theme="dark" />
          <span>正在整理...</span>
        </div>
      )}
    </div>
  );
}
