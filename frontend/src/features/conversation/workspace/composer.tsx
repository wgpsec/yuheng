import { FormEvent, useLayoutEffect, useRef, useState } from 'react';
import type { Attachment } from '../../../contracts/desktop-bridge';

export function Composer({ busy, attachments, onAttach, onRemoveAttachment, onSubmit, onCancel }: { busy: boolean; attachments: Attachment[]; onAttach: () => Promise<void>; onRemoveAttachment: (id: string) => void; onSubmit: (value: string, attachments: Attachment[]) => void; onCancel: () => void }) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [value]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = value.trim();
    if ((!text && attachments.length === 0) || busy) return;
    onSubmit(text, attachments);
    setValue('');
  };

  return (
    <form className="composer" onSubmit={submit}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        placeholder="写下你的想法..."
        aria-label="消息内容"
        rows={1}
        disabled={busy}
      />
      {attachments.length > 0 && <div className="attachment-list" aria-label="待发送附件">{attachments.map((attachment) => <span className="attachment-chip" key={attachment.id}><span className="attachment-chip-name">{attachment.name}</span><small>{Math.max(1, Math.round(attachment.size / 1024))} KB</small><button type="button" onClick={() => onRemoveAttachment(attachment.id)} aria-label={`移除附件 ${attachment.name}`}>×</button></span>)}</div>}
      <div className="composer-actions">
        <div className="composer-tools"><button type="button" className="tool-button" onClick={() => void onAttach()} disabled={busy} aria-label="添加附件">＋ 附件</button></div>
        {busy ? (
          <button type="button" className="send-button stop" onClick={onCancel} aria-label="停止处理">停止</button>
        ) : (
          <button type="submit" className="send-button" aria-label="发送消息">发送</button>
        )}
      </div>
    </form>
  );
}
