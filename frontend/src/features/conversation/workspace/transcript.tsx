import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ThinkingOrb } from 'thinking-orbs';

export type TranscriptAttachment = { id: string; name: string; size: number };
export type TranscriptMessage = { id: string; role: 'user' | 'assistant'; content: string; time: string; attachments?: TranscriptAttachment[] };
export type RecoveryNotice = { message: string; onRetry: () => void };

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
  return <div className="message-markdown"><Markdown remarkPlugins={[remarkGfm]} components={{
    pre({ children }) { return <>{children}</>; },
    code({ className, children }) {
      const value = String(children).replace(/\n$/, '');
      const language = className?.match(/language-(\w+)/)?.[1];
      if (!className && !value.includes('\n')) return <code>{children}</code>;
      return <CodeBlock language={language}>{value}</CodeBlock>;
    },
  }}>{content}</Markdown></div>;
}

export function Transcript({ messages, isThinking, recoveryNotice }: { messages: TranscriptMessage[]; isThinking: boolean; recoveryNotice?: RecoveryNotice | null }) {
  return (
    <div className="transcript" aria-live="polite">
      {messages.length === 0 && <div className="welcome-block">
        <div className="welcome-orb"><ThinkingOrb state="breathing" size={64} theme="dark" /></div>
        <h2>今天想先处理什么？</h2>
        <p>把想法、资料或下一步行动交给玉衡。</p>
        <div className="suggestion-row"><button type="button">整理今天的计划</button><button type="button">总结一份资料</button><button type="button">记录一个待办</button></div>
      </div>}
      {messages.length > 0 && <div className="message-list">
        {messages.map((message) => <article className={`message ${message.role}`} key={message.id}>
          <div className="message-avatar">{message.role === 'assistant' ? <ThinkingOrb state="breathing" size={20} theme="dark" /> : '你'}</div>
          <div className="message-body"><div className="message-meta"><strong>{message.role === 'assistant' ? '玉衡' : '你'}</strong><time>{message.time}</time></div>{message.role === 'assistant' ? <AssistantContent content={message.content} /> : <p>{message.content}</p>}{message.attachments && message.attachments.length > 0 && <div className="message-attachments" aria-label="消息附件">{message.attachments.map((attachment) => <span className="message-attachment" key={attachment.id}><span className="message-attachment-icon">↗</span><span className="message-attachment-name">{attachment.name}</span><small>{Math.max(1, Math.round(attachment.size / 1024))} KB</small></span>)}</div>}</div>
        </article>)}
      </div>}
      {recoveryNotice && <div className="recovery-notice" role="status"><div><strong>上次运行已中断</strong><p>{recoveryNotice.message}</p></div><button type="button" onClick={recoveryNotice.onRetry}>重新发送</button></div>}
      {isThinking && (
        <div className="assistant-message pending-message">
          <ThinkingOrb state="working" size={20} theme="dark" />
          <span>正在整理...</span>
        </div>
      )}
    </div>
  );
}
