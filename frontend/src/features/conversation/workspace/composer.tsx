import { BrainCircuit, Check, ChevronDown } from 'lucide-react';
import { FormEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Attachment, ReasoningLevel, ReasoningSelection } from '../../../contracts/desktop-bridge';

const reasoningOptions: Array<{ value: ReasoningSelection; label: string }> = [
  { value: 'default', label: '默认' },
  { value: 'off', label: '关闭' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
  { value: 'max', label: 'Max' },
];

export interface ComposerPrefill {
  id: number;
  value: string;
}

export function Composer({ busy, attachments, variant = 'default', prefill, editing = false, onCancelEdit, reasoningSelection = 'default', onReasoningSelectionChange, onAttach, onRemoveAttachment, onSubmit, onCancel }: { busy: boolean; attachments: Attachment[]; variant?: 'default' | 'start'; prefill?: ComposerPrefill | null; editing?: boolean; onCancelEdit?: () => void; reasoningSelection?: ReasoningSelection; onReasoningSelectionChange?: (selection: ReasoningSelection) => void; onAttach: () => Promise<void>; onRemoveAttachment: (id: string) => void; onSubmit: (value: string, attachments: Attachment[], reasoningLevel?: ReasoningLevel) => void; onCancel: () => void }) {
  const [value, setValue] = useState('');
  const [reasoningLevel, setReasoningLevel] = useState<ReasoningSelection>(reasoningSelection);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [reasoningClosing, setReasoningClosing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const reasoningPickerRef = useRef<HTMLDivElement>(null);
  const reasoningCloseTimer = useRef<number | null>(null);
  const closeReasoning = () => {
    if (!reasoningOpen) return;
    setReasoningOpen(false);
    setReasoningClosing(true);
    if (reasoningCloseTimer.current !== null) window.clearTimeout(reasoningCloseTimer.current);
    reasoningCloseTimer.current = window.setTimeout(() => { setReasoningClosing(false); reasoningCloseTimer.current = null; }, 125);
  };
  useEffect(() => () => { if (reasoningCloseTimer.current !== null) window.clearTimeout(reasoningCloseTimer.current); }, []);
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [value]);
  useEffect(() => {
    if (!reasoningOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!reasoningPickerRef.current?.contains(event.target as Node)) closeReasoning();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeReasoning();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [reasoningOpen]);
  useEffect(() => { setReasoningLevel(reasoningSelection); }, [reasoningSelection]);
  useEffect(() => {
    if (!prefill) return;
    setValue(prefill.value);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(prefill.value.length, prefill.value.length);
      textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, [prefill]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = value.trim();
    if ((!text && attachments.length === 0) || busy) return;
    onSubmit(text, attachments, reasoningLevel === 'default' ? undefined : reasoningLevel);
    setValue('');
  };

  return (
    <form className={`composer ${variant === 'start' ? 'composer-start' : ''} ${editing ? 'is-editing' : ''}`} onSubmit={submit}>
      {editing && <div className="composer-editing-state"><span>正在编辑消息，发送后将替换原消息及后续回复</span>{onCancelEdit && <button type="button" onClick={onCancelEdit}>取消</button>}</div>}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
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
        <div className="composer-tools"><button type="button" className="tool-button" onClick={() => void onAttach()} disabled={busy} aria-label="添加附件">＋ 附件</button><div className="reasoning-picker" ref={reasoningPickerRef}><button type="button" className="reasoning-trigger" onClick={() => { if (reasoningOpen) closeReasoning(); else { setReasoningClosing(false); setReasoningOpen(true); } }} disabled={busy} aria-label={`推理级别：${reasoningOptions.find((option) => option.value === reasoningLevel)?.label}`} aria-haspopup="menu" aria-expanded={reasoningOpen}><BrainCircuit size={14} aria-hidden="true" /><span>{reasoningOptions.find((option) => option.value === reasoningLevel)?.label}</span><ChevronDown size={13} aria-hidden="true" /></button>{(reasoningOpen || reasoningClosing) && <div className={`reasoning-menu ${reasoningClosing ? 'is-closing' : ''}`} role="menu" aria-label="选择推理级别">{reasoningOptions.map((option) => <button type="button" key={option.value} className={reasoningLevel === option.value ? 'is-selected' : ''} role="menuitemradio" aria-checked={reasoningLevel === option.value} onClick={() => { setReasoningLevel(option.value); closeReasoning(); }}><span>{option.label}</span>{reasoningLevel === option.value && <Check size={13} aria-hidden="true" />}</button>)}</div>}</div></div>
        <div className="composer-submit-actions">
        {busy ? (
          <button type="button" className="send-button stop" onClick={onCancel} aria-label="停止处理">停止</button>
        ) : (
          <button type="submit" className="send-button" aria-label="发送消息">发送</button>
        )}
        </div>
      </div>
    </form>
  );
}
