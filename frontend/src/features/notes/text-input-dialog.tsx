import type { FormEvent } from 'react';
import { createPortal } from 'react-dom';

export function TextInputDialog({ title, value, placeholder, submitLabel = '确定', onChange, onCancel, onSubmit }: {
  title: string;
  value: string;
  placeholder?: string;
  submitLabel?: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: (value: string) => void | Promise<void>;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextValue = value.trim();
    if (!nextValue) return;
    void onSubmit(nextValue);
  };

  if (typeof document === 'undefined') return null;
  return createPortal(<div className="notes-input-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <form className="notes-input-dialog" role="dialog" aria-modal="true" aria-label={title} onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
      <h2>{title}</h2>
      <input autoFocus value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      <div className="notes-input-dialog-actions">
        <button type="button" onClick={onCancel}>取消</button>
        <button type="submit" className="is-primary">{submitLabel}</button>
      </div>
    </form>
  </div>, document.body);
}
