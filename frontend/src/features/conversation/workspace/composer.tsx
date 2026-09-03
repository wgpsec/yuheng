import { BrainCircuit, Check, ChevronDown, Globe2, MonitorCog, ShieldAlert, ShieldCheck, ShieldOff, Sparkles, type LucideIcon } from 'lucide-react';
import { FormEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AgentSkillCatalogEntry, Attachment, ConversationCapabilities, ConversationCapabilityOverride, ReasoningLevel, ReasoningSelection, ToolPermissionMode } from '../../../contracts/desktop-bridge';

const reasoningOptions: Array<{ value: ReasoningSelection; label: string }> = [
  { value: 'default', label: '默认' },
  { value: 'off', label: '关闭' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
  { value: 'max', label: 'Max' },
];

const permissionOptions: Array<{
  value: ToolPermissionMode;
  label: string;
  shortLabel: string;
  description: string;
  icon: LucideIcon;
}> = [
  { value: 'cautious', label: '谨慎模式', shortLabel: '谨慎', description: '写入、Shell 和外部操作均需确认', icon: ShieldAlert },
  { value: 'smart', label: '智能审批', shortLabel: '智能', description: '工作区写入自动允许，高风险操作需确认', icon: ShieldCheck },
  { value: 'full_session', label: '完全访问', shortLabel: '完全', description: '本次应用会话内不再询问工具操作', icon: ShieldOff },
];

export interface ComposerPrefill {
  id: number;
  value: string;
}

type ComposerProps = {
  busy: boolean;
  attachments: Attachment[];
  variant?: 'default' | 'start';
  prefill?: ComposerPrefill | null;
  editing?: boolean;
  onCancelEdit?: () => void;
  reasoningSelection?: ReasoningSelection;
  onReasoningSelectionChange?: (selection: ReasoningSelection) => void;
  permissionMode?: ToolPermissionMode;
  onPermissionModeChange?: (mode: ToolPermissionMode) => void;
  conversationCapabilities?: ConversationCapabilities;
  defaultCapabilities?: { browserUse: boolean; computerUse: boolean };
  onCapabilityChange?: (capability: keyof ConversationCapabilities, value: ConversationCapabilityOverride) => void;
  skillCatalog?: AgentSkillCatalogEntry[];
  selectedSkillIds?: string[];
  onSkillIdsChange?: (skillIds: string[]) => void;
  onAttach: () => Promise<void>;
  onRemoveAttachment: (id: string) => void;
  onSubmit: (value: string, attachments: Attachment[], reasoningLevel?: ReasoningLevel) => void;
  onCancel: () => void;
};

type ComposerMenu = 'permission' | 'reasoning' | 'browser' | 'computer' | 'skills';

export function Composer({
  busy,
  attachments,
  variant = 'default',
  prefill,
  editing = false,
  onCancelEdit,
  reasoningSelection = 'default',
  onReasoningSelectionChange,
  permissionMode = 'smart',
  onPermissionModeChange,
  conversationCapabilities = { browserUse: 'default', computerUse: 'default' },
  defaultCapabilities = { browserUse: false, computerUse: false },
  onCapabilityChange,
  skillCatalog = [],
  selectedSkillIds = [],
  onSkillIdsChange,
  onAttach,
  onRemoveAttachment,
  onSubmit,
  onCancel,
}: ComposerProps) {
  const [value, setValue] = useState('');
  const [reasoningLevel, setReasoningLevel] = useState<ReasoningSelection>(reasoningSelection);
  const [openMenu, setOpenMenu] = useState<ComposerMenu | null>(null);
  const [closingMenu, setClosingMenu] = useState<ComposerMenu | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pickerAreaRef = useRef<HTMLDivElement>(null);
  const menuCloseTimer = useRef<number | null>(null);

  const closeMenu = (menu = openMenu) => {
    if (!menu) return;
    setOpenMenu(null);
    setClosingMenu(menu);
    if (menuCloseTimer.current !== null) window.clearTimeout(menuCloseTimer.current);
    menuCloseTimer.current = window.setTimeout(() => {
      setClosingMenu(null);
      menuCloseTimer.current = null;
    }, 125);
  };

  const toggleMenu = (menu: ComposerMenu) => {
    if (openMenu === menu) {
      closeMenu(menu);
      return;
    }
    if (menuCloseTimer.current !== null) window.clearTimeout(menuCloseTimer.current);
    setClosingMenu(null);
    setOpenMenu(menu);
  };

  useEffect(() => () => {
    if (menuCloseTimer.current !== null) window.clearTimeout(menuCloseTimer.current);
  }, []);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [value]);

  useEffect(() => {
    if (!openMenu) return;
    const closeOutside = (event: PointerEvent) => {
      if (!pickerAreaRef.current?.contains(event.target as Node)) closeMenu();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openMenu]);

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

  const selectedPermission = permissionOptions.find((option) => option.value === permissionMode) ?? permissionOptions[1];
  const PermissionIcon = selectedPermission.icon;
  const browserEnabled = conversationCapabilities.browserUse === 'enabled' || (conversationCapabilities.browserUse === 'default' && defaultCapabilities.browserUse);
  const computerEnabled = conversationCapabilities.computerUse === 'enabled' || (conversationCapabilities.computerUse === 'default' && defaultCapabilities.computerUse);
  const selectedSkillCount = selectedSkillIds.length;
  const capabilityMenu = (kind: 'browser' | 'computer', key: keyof ConversationCapabilities, label: string, Icon: LucideIcon, enabled: boolean) => (
    <div className="capability-picker">
      <button type="button" className={`capability-trigger ${enabled ? 'is-enabled' : ''}`} onClick={() => toggleMenu(kind)} disabled={busy} aria-label={`${label}：${enabled ? '已开启' : '已关闭'}`} title={kind === 'computer' && enabled ? '已开启桌面能力，同时加载 Computer Use Skill' : undefined} aria-haspopup="menu" aria-expanded={openMenu === kind}>
        <Icon size={14} aria-hidden="true" /><span>{label}</span><ChevronDown size={12} aria-hidden="true" />
      </button>
      {(openMenu === kind || closingMenu === kind) && <div className={`capability-menu ${closingMenu === kind ? 'is-closing' : ''}`} role="menu" aria-label={`${label}设置`}>
        {([['default', '跟随默认', '使用设置页中的默认值'], ['enabled', '开启', `当前会话始终开启${label}`], ['disabled', '关闭', `当前会话不使用${label}`]] as const).map(([value, optionLabel, baseDescription]) => {
          const description = kind === 'computer'
            ? value === 'disabled' ? '关闭桌面能力，也不会加载 Computer Use Skill' : value === 'enabled' ? '开启桌面能力，并加载 Computer Use Skill' : '跟随默认设置；桌面能力开启时加载 Computer Use Skill'
            : baseDescription;
          return (
          <button type="button" key={value} className={conversationCapabilities[key] === value ? 'is-selected' : ''} role="menuitemradio" aria-checked={conversationCapabilities[key] === value} onClick={() => { onCapabilityChange?.(key, value); closeMenu(kind); }}><span><strong>{optionLabel}</strong><small>{description}</small></span>{conversationCapabilities[key] === value && <Check size={13} aria-hidden="true" />}</button>
          );
        })}
      </div>}
    </div>
  );

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
        <div className="composer-tools" ref={pickerAreaRef}>
          <button type="button" className="tool-button" onClick={() => void onAttach()} disabled={busy} aria-label="添加附件">＋ 附件</button>
          {capabilityMenu('browser', 'browserUse', '浏览器', Globe2, browserEnabled)}
          {capabilityMenu('computer', 'computerUse', '桌面', MonitorCog, computerEnabled)}
          <div className="capability-picker">
            <button type="button" className={`capability-trigger ${selectedSkillCount > 0 ? 'is-enabled' : ''}`} onClick={() => toggleMenu('skills')} disabled={busy} aria-label={`Skills：已选择 ${selectedSkillCount} 个`} aria-haspopup="menu" aria-expanded={openMenu === 'skills'}>
              <Sparkles size={14} aria-hidden="true" /><span>Skills{selectedSkillCount ? ` ${selectedSkillCount}` : ''}</span><ChevronDown size={12} aria-hidden="true" />
            </button>
            {(openMenu === 'skills' || closingMenu === 'skills') && <div className={`capability-menu skills-menu ${closingMenu === 'skills' ? 'is-closing' : ''}`} role="menu" aria-label="选择 Skills">
              {skillCatalog.filter((skill) => skill.source === 'user').map((skill) => {
                const selected = selectedSkillIds.includes(skill.id);
                return <button type="button" key={skill.id} className={selected ? 'is-selected' : ''} role="menuitemcheckbox" aria-checked={selected} disabled={!skill.available || skill.enabled !== true} onClick={() => { const next = selected ? selectedSkillIds.filter((id) => id !== skill.id) : [...selectedSkillIds, skill.id]; onSkillIdsChange?.(next); }}><span><strong>{skill.name}</strong><small>{!skill.available ? '文件不可用' : skill.enabled !== true ? '请先在设置中启用' : skill.description}</small></span>{selected && <Check size={13} aria-hidden="true" />}</button>;
              })}
              {skillCatalog.filter((skill) => skill.source === 'user').length === 0 && <div className="capability-menu-empty"><Sparkles size={15} aria-hidden="true" /><span><strong>暂无已启用 Skill</strong><small>前往设置导入并启用</small></span></div>}
            </div>}
          </div>
          <div className="permission-picker">
            <button
              type="button"
              className={`permission-trigger ${permissionMode === 'full_session' ? 'is-full-access' : ''}`}
              onClick={() => toggleMenu('permission')}
              disabled={busy}
              aria-label={`工具权限：${selectedPermission.label}`}
              aria-haspopup="menu"
              aria-expanded={openMenu === 'permission'}
            >
              <PermissionIcon size={14} aria-hidden="true" />
              <span>{selectedPermission.shortLabel}</span>
              <ChevronDown size={13} aria-hidden="true" />
            </button>
            {(openMenu === 'permission' || closingMenu === 'permission') && (
              <div className={`permission-menu ${closingMenu === 'permission' ? 'is-closing' : ''}`} role="menu" aria-label="选择工具权限">
                {permissionOptions.map((option) => {
                  const OptionIcon = option.icon;
                  return (
                    <button
                      type="button"
                      key={option.value}
                      className={`${permissionMode === option.value ? 'is-selected' : ''} ${option.value === 'full_session' ? 'is-dangerous' : ''}`}
                      role="menuitemradio"
                      aria-checked={permissionMode === option.value}
                      onClick={() => {
                        closeMenu('permission');
                        if (permissionMode !== option.value) onPermissionModeChange?.(option.value);
                      }}
                    >
                      <OptionIcon size={15} aria-hidden="true" />
                      <span><strong>{option.label}</strong><small>{option.description}</small></span>
                      {permissionMode === option.value && <Check size={14} aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="reasoning-picker">
            <button type="button" className="reasoning-trigger" onClick={() => toggleMenu('reasoning')} disabled={busy} aria-label={`推理级别：${reasoningOptions.find((option) => option.value === reasoningLevel)?.label}`} aria-haspopup="menu" aria-expanded={openMenu === 'reasoning'}><BrainCircuit size={14} aria-hidden="true" /><span>{reasoningOptions.find((option) => option.value === reasoningLevel)?.label}</span><ChevronDown size={13} aria-hidden="true" /></button>
            {(openMenu === 'reasoning' || closingMenu === 'reasoning') && <div className={`reasoning-menu ${closingMenu === 'reasoning' ? 'is-closing' : ''}`} role="menu" aria-label="选择推理级别">{reasoningOptions.map((option) => <button type="button" key={option.value} className={reasoningLevel === option.value ? 'is-selected' : ''} role="menuitemradio" aria-checked={reasoningLevel === option.value} onClick={() => { setReasoningLevel(option.value); onReasoningSelectionChange?.(option.value); closeMenu('reasoning'); }}><span>{option.label}</span>{reasoningLevel === option.value && <Check size={13} aria-hidden="true" />}</button>)}</div>}
          </div>
        </div>
        <div className="composer-submit-actions">
          {busy ? <button type="button" className="send-button stop" onClick={onCancel} aria-label="停止处理">停止</button> : <button type="submit" className="send-button" aria-label="发送消息">发送</button>}
        </div>
      </div>
    </form>
  );
}
