import { X } from 'lucide-react';
import { useEffect } from 'react';
import { NOTE_TEMPLATES, type NoteTemplate } from './note-templates';

export function NoteTemplatePicker({ onSelect, onClose, busy = false }: { onSelect: (template: NoteTemplate) => void; onClose: () => void; busy?: boolean }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [busy, onClose]);
  return <div className="note-template-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="note-template-picker" role="dialog" aria-modal="true" aria-label="选择页面模板">
      <header><div><strong>新建页面</strong><span>选择一个起点，创建后可以自由修改</span></div><button type="button" onClick={onClose} aria-label="关闭模板选择器"><X size={16} /></button></header>
      <div className="note-template-grid">{NOTE_TEMPLATES.map((template) => <button type="button" key={template.id} disabled={busy} onClick={() => onSelect(template)}><span className="note-template-icon">{template.icon ?? '▧'}</span><span><strong>{template.name}</strong><small>{template.description}</small></span></button>)}</div>
    </section>
  </div>;
}
