import { ArrowUp, Bot, LoaderCircle, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { buildContextAiTurnPrompt } from './context-ai';

type ChatMessage = { id: number; role: 'user' | 'assistant'; content: string };

export function ContextAiDrawer({ sourceLabel, onSend }: {
  sourceLabel: string;
  onSend: (prompt: string, signal: AbortSignal) => Promise<string>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const controllerRef = useRef<AbortController | null>(null);
  const sequenceRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);
  useEffect(() => () => controllerRef.current?.abort(), []);

  const close = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setBusy(false);
    setOpen(false);
  };
  const submit = async () => {
    const prompt = draft.trim();
    if (!prompt || busy) return;
    const id = ++sequenceRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    setDraft('');
    setError(null);
    setMessages((current) => [...current, { id, role: 'user', content: prompt }]);
    setBusy(true);
    try {
      const reply = await onSend(buildContextAiTurnPrompt(messages, prompt), controller.signal);
      if (controller.signal.aborted || id !== sequenceRef.current) return;
      setMessages((current) => [...current, { id: id + 0.5, role: 'assistant', content: reply }]);
    } catch (reason) {
      if (!controller.signal.aborted && id === sequenceRef.current) setError(reason instanceof Error ? reason.message : '页面 AI 请求失败。');
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      if (id === sequenceRef.current) setBusy(false);
    }
  };

  return <div className="context-ai-root">
    {open && <aside className="context-ai-drawer" role="dialog" aria-modal="false" aria-label={`${sourceLabel} AI 对话`}>
      <header className="context-ai-header"><div><span className="context-ai-kicker"><Bot size={14} />页面 AI</span><strong>{sourceLabel}</strong></div><button type="button" className="context-ai-close" onClick={close} aria-label="关闭页面 AI"><X size={17} /></button></header>
      <div className="context-ai-messages" aria-live="polite">
        {messages.length === 0 && <div className="context-ai-empty"><Bot size={25} /><strong>和{sourceLabel}对话</strong><span>我会基于当前内容回答，不会自动修改页面。</span></div>}
        {messages.map((message) => <div key={message.id} className={`context-ai-message is-${message.role}`}><span>{message.content}</span></div>)}
        {busy && <div className="context-ai-message is-assistant context-ai-thinking"><LoaderCircle size={14} />正在思考…</div>}
        {error && <div className="context-ai-error" role="alert">{error}</div>}
        <div ref={endRef} />
      </div>
      <form className="context-ai-composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="询问此页面…" aria-label="页面 AI 输入" rows={2} disabled={busy} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.altKey)) { event.preventDefault(); void submit(); } }} /><div><small>⌘↵ 发送</small>{busy ? <button type="button" className="context-ai-stop" onClick={() => controllerRef.current?.abort()}>停止</button> : <button type="submit" className="context-ai-send" disabled={!draft.trim()} aria-label="发送"><ArrowUp size={16} /></button>}</div></form>
    </aside>}
    <button type="button" className={`context-ai-fab ${open ? 'is-open' : ''}`} onClick={() => setOpen((current) => !current)} aria-label={open ? '关闭页面 AI' : `和${sourceLabel}对话`} title={open ? '关闭页面 AI' : `和${sourceLabel}对话`}><Bot size={19} /><span>{open ? '关闭' : `和${sourceLabel}对话`}</span></button>
  </div>;
}
