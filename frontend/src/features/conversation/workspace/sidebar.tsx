import { Archive, ArchiveRestore, LayoutDashboard, ListTodo, MessageSquare, MessageSquarePlus, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, Pin, PinOff, Plus, Search, Settings, Trash2 } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import type { TaskBoard } from '../../../contracts/desktop-bridge';

export type Conversation = { id: string; title: string; updatedAt?: string; time?: string; archived?: boolean; pinned?: boolean };
type WorkspaceMode = 'conversation' | 'tasks';

export function Sidebar({ conversations, boards, activeId, activeBoardId, mode, settingsOpen, collapsed, onSearch, onSelect, onSelectBoard, onModeChange, onNew, onRenameConversation, onArchiveConversation, onPinConversation, onDeleteConversation, onCreateBoard, onRenameBoard, onSettings, onToggle }: {
  conversations: Conversation[];
  boards: TaskBoard[];
  activeId: string;
  activeBoardId: string;
  mode: WorkspaceMode;
  settingsOpen: boolean;
  collapsed: boolean;
  onSearch: () => void;
  onSelect: (id: string) => void;
  onSelectBoard: (id: string) => void;
  onModeChange: (mode: WorkspaceMode) => void;
  onNew: () => void;
  onRenameConversation: (id: string, title: string) => Promise<void>;
  onArchiveConversation: (id: string, archived: boolean) => Promise<void>;
  onPinConversation: (id: string, pinned: boolean) => Promise<void>;
  onDeleteConversation: (id: string) => Promise<void>;
  onCreateBoard: (name: string) => Promise<void>;
  onRenameBoard: (id: string, name: string) => Promise<void>;
  onSettings: () => void;
  onToggle: () => void;
}) {
  const [creatingBoard, setCreatingBoard] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');
  const [renamingBoardId, setRenamingBoardId] = useState<string | null>(null);
  const [renamingBoardName, setRenamingBoardName] = useState('');
  const [boardError, setBoardError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [renamingConversationId, setRenamingConversationId] = useState<string | null>(null);
  const [renamingConversationTitle, setRenamingConversationTitle] = useState('');
  const [conversationMenuId, setConversationMenuId] = useState<string | null>(null);
  const [conversationError, setConversationError] = useState<string | null>(null);

  const createBoard = async () => {
    const name = newBoardName.trim();
    if (!name) return;
    try {
      await onCreateBoard(name);
      setNewBoardName('');
      setCreatingBoard(false);
      setBoardError(null);
    } catch (reason) {
      setBoardError(reason instanceof Error ? reason.message : '新建看板失败。');
    }
  };
  const renameBoard = async () => {
    const id = renamingBoardId;
    const name = renamingBoardName.trim();
    setRenamingBoardId(null);
    if (!id || !name) return;
    try {
      await onRenameBoard(id, name);
      setBoardError(null);
    } catch (reason) {
      setBoardError(reason instanceof Error ? reason.message : '修改看板名称失败。');
    }
  };
  const submitOnEnter = (event: KeyboardEvent<HTMLInputElement>, action: () => Promise<void>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void action();
    }
    if (event.key === 'Escape') {
      setCreatingBoard(false);
      setRenamingBoardId(null);
    }
  };
  const visibleConversations = conversations.filter((conversation) => Boolean(conversation.archived) === showArchived);
  const renameConversation = async () => {
    const id = renamingConversationId;
    const title = renamingConversationTitle.trim();
    setRenamingConversationId(null);
    if (!id || !title) return;
    try { await onRenameConversation(id, title); setConversationError(null); }
    catch (reason) { setConversationError(reason instanceof Error ? reason.message : '重命名会话失败。'); }
  };
  const archiveConversation = async (conversation: Conversation) => {
    try { await onArchiveConversation(conversation.id, !conversation.archived); setConversationMenuId(null); setConversationError(null); }
    catch (reason) { setConversationError(reason instanceof Error ? reason.message : '归档会话失败。'); }
  };
  const pinConversation = async (conversation: Conversation) => {
    try { await onPinConversation(conversation.id, !conversation.pinned); setConversationMenuId(null); setConversationError(null); }
    catch (reason) { setConversationError(reason instanceof Error ? reason.message : '置顶会话失败。'); }
  };
  const deleteConversation = async (conversation: Conversation) => {
    if (!window.confirm(`删除“${conversation.title}”及其所有消息和运行记录？此操作无法撤销。`)) return;
    try { await onDeleteConversation(conversation.id); setConversationMenuId(null); setConversationError(null); }
    catch (reason) { setConversationError(reason instanceof Error ? reason.message : '删除会话失败。'); }
  };

  return (
    <aside className="sidebar" aria-label="工作区导航" data-collapsed={collapsed}>
      <div className="sidebar-topbar">
        <button type="button" className="icon-button sidebar-toggle" onClick={onToggle} aria-label={collapsed ? '展开侧栏' : '收起侧栏'} title={collapsed ? '展开侧栏' : '收起侧栏'}>
          {collapsed ? <PanelLeftOpen size={17} aria-hidden="true" /> : <PanelLeftClose size={17} aria-hidden="true" />}
        </button>
      </div>
      <button type="button" className="sidebar-search-trigger" onClick={onSearch} aria-label="搜索玉衡">
        <Search size={15} aria-hidden="true" /><span>搜索玉衡</span><kbd>⌘K</kbd>
      </button>
      <div className={`sidebar-mode-switch is-${mode}`} role="tablist" aria-label="工作区类型">
        <button type="button" role="tab" aria-selected={mode === 'conversation'} className={mode === 'conversation' ? 'is-selected' : ''} onClick={() => onModeChange('conversation')} title="对话">
          <MessageSquare size={15} aria-hidden="true" />{mode === 'conversation' && <span>对话</span>}
        </button>
        <button type="button" role="tab" aria-selected={mode === 'tasks'} className={mode === 'tasks' ? 'is-selected' : ''} onClick={() => onModeChange('tasks')} title="任务">
          <ListTodo size={15} aria-hidden="true" />{mode === 'tasks' && <span>任务</span>}
        </button>
      </div>

      <div key={mode} className={`sidebar-mode-content is-${mode}`}>
      {mode === 'conversation' ? <>
        {!collapsed && <div className="conversation-list-heading"><div className="conversation-label">{showArchived ? '已归档' : '最近会话'}</div><button type="button" className={`conversation-archive-toggle ${showArchived ? 'is-selected' : ''}`} onClick={() => setShowArchived((current) => !current)} aria-pressed={showArchived} title={showArchived ? '查看进行中的会话' : '查看已归档会话'}>{showArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}</button></div>}
        <nav className="conversation-list" aria-label="最近会话">
          {visibleConversations.map((conversation) => (
            <div className={`conversation-row ${!settingsOpen && activeId === conversation.id ? 'is-selected' : ''}`} key={conversation.id}>
              {renamingConversationId === conversation.id && !collapsed ? <input className="conversation-rename-input" autoFocus value={renamingConversationTitle} onChange={(event) => setRenamingConversationTitle(event.target.value)} onBlur={() => void renameConversation()} onKeyDown={(event) => submitOnEnter(event, renameConversation)} aria-label="会话名称" /> : <><button type="button" className="conversation-item" onClick={() => onSelect(conversation.id)} title={conversation.title}><span className="conversation-title">{conversation.pinned && !collapsed && <Pin size={12} aria-label="已置顶" />}{collapsed ? conversation.title.slice(0, 1) : conversation.title}</span>{!collapsed && <time>{conversation.time ?? (conversation.updatedAt ? new Date(conversation.updatedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '')}</time>}</button>{!collapsed && <button type="button" className="conversation-menu-button" onClick={() => setConversationMenuId((current) => current === conversation.id ? null : conversation.id)} aria-label={`管理${conversation.title}`} title="管理会话"><MoreHorizontal size={15} /></button>}{conversationMenuId === conversation.id && !collapsed && <div className="conversation-menu"><button type="button" onClick={() => { setRenamingConversationId(conversation.id); setRenamingConversationTitle(conversation.title); setConversationMenuId(null); }}><Pencil size={13} />重命名</button><button type="button" onClick={() => void pinConversation(conversation)}>{conversation.pinned ? <PinOff size={13} /> : <Pin size={13} />}{conversation.pinned ? '取消置顶' : '置顶'}</button><button type="button" onClick={() => void archiveConversation(conversation)}>{conversation.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}{conversation.archived ? '恢复归档' : '归档'}</button><button type="button" className="is-destructive" onClick={() => void deleteConversation(conversation)}><Trash2 size={13} />删除</button></div>}</>}
            </div>
          ))}
          {!collapsed && visibleConversations.length === 0 && <div className="conversation-list-empty">{showArchived ? '暂无已归档会话' : '暂无会话'}</div>}
        </nav>
        {conversationError && !collapsed && <p className="sidebar-board-error" role="alert">{conversationError}</p>}
      </> : <>
        <div className="task-board-list-heading">
          {!collapsed && <span>任务看板</span>}
          <button type="button" onClick={() => { if (collapsed) onToggle(); setCreatingBoard(true); }} aria-label="新建任务看板" title="新建任务看板"><Plus size={14} /></button>
        </div>
        <nav className="task-board-list" aria-label="任务看板">
          {boards.map((board) => <div className={`task-board-nav-row ${!settingsOpen && activeBoardId === board.id ? 'is-selected' : ''}`} key={board.id}>
            {renamingBoardId === board.id && !collapsed ? <input autoFocus value={renamingBoardName} onChange={(event) => setRenamingBoardName(event.target.value)} onBlur={() => void renameBoard()} onKeyDown={(event) => submitOnEnter(event, renameBoard)} aria-label="任务看板名称" /> : <>
              <button type="button" className="task-board-nav-select" onClick={() => onSelectBoard(board.id)} title={board.name}>
                <LayoutDashboard size={15} aria-hidden="true" />
                {!collapsed && <span>{board.name}</span>}
              </button>
              {!collapsed && <button type="button" className="task-board-nav-rename" onClick={() => { setRenamingBoardId(board.id); setRenamingBoardName(board.name); }} aria-label={`修改${board.name}名称`} title="修改看板名称"><Pencil size={12} /></button>}
            </>}
          </div>)}
          {creatingBoard && !collapsed && <div className="task-board-create-row"><LayoutDashboard size={15} /><input autoFocus value={newBoardName} onChange={(event) => setNewBoardName(event.target.value)} onBlur={() => { if (!newBoardName.trim()) setCreatingBoard(false); }} onKeyDown={(event) => submitOnEnter(event, createBoard)} placeholder="看板名称" aria-label="新任务看板名称" /><button type="button" onClick={() => void createBoard()} disabled={!newBoardName.trim()}>添加</button></div>}
          {boardError && !collapsed && <p className="sidebar-board-error" role="alert">{boardError}</p>}
        </nav>
      </>}
      </div>

      <div className="sidebar-bottom">
        {mode === 'conversation' && <div className="sidebar-new-chat">
          <button type="button" className="primary-action" onClick={onNew} aria-label="新会话" title="新会话">
            <MessageSquarePlus size={17} aria-hidden="true" />
            {!collapsed && <span>新会话</span>}
          </button>
        </div>}
        <div className="sidebar-settings-area">
          <button type="button" className={`workspace-nav-item ${settingsOpen ? 'is-selected' : ''}`} onClick={onSettings} aria-current={settingsOpen ? 'page' : undefined} title="设置">
            <Settings size={16} aria-hidden="true" /><span>设置</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
