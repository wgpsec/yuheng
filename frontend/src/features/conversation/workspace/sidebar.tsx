export type Conversation = { id: string; title: string; updatedAt?: string; time?: string };

export function Sidebar({ conversations, activeId, collapsed, onSelect, onNew, onSettings, onToggle }: { conversations: Conversation[]; activeId: string; collapsed: boolean; onSelect: (id: string) => void; onNew: () => void; onSettings: () => void; onToggle: () => void }) {
  return (
    <aside className="sidebar" aria-label="会话列表" data-collapsed={collapsed}>
      <div className="brand-row">
        <div className="brand-mark">衡</div>
        {!collapsed && <span>玉衡</span>}
        <button type="button" className="icon-button sidebar-settings" onClick={onToggle} aria-label={collapsed ? '展开侧栏' : '收起侧栏'}>{collapsed ? '›' : '‹'}</button>
      </div>
      <div className="sidebar-actions" aria-label="会话操作">
        <button type="button" className="primary-action" onClick={onNew} aria-label="新会话">{collapsed ? '+' : '+ 新会话'}</button>
        {!collapsed && <button type="button" className="secondary-action" aria-label="搜索会话">⌕ <span>搜索</span></button>}
      </div>
      {!collapsed && <div className="conversation-label">最近会话</div>}
      <nav className="conversation-list">
        {conversations.map((conversation) => (
          <button
            type="button"
            key={conversation.id}
            className={`conversation-item ${activeId === conversation.id ? 'is-selected' : ''}`}
            onClick={() => onSelect(conversation.id)}
          >
            <span className="conversation-title">{collapsed ? conversation.title.slice(0, 1) : conversation.title}</span>
            {!collapsed && <time>{conversation.time ?? (conversation.updatedAt ? new Date(conversation.updatedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '')}</time>}
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <span className="avatar">F</span>
        {!collapsed && <div><strong>本地工作区</strong><small>未连接云端</small></div>}
        <button type="button" className="settings-link" onClick={onSettings} aria-label="打开设置">⚙<span>设置</span></button>
      </div>
    </aside>
  );
}
