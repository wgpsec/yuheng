import { Archive, ArchiveRestore, Check, ChevronDown, Folder, FolderOpen, LayoutDashboard, ListTodo, MessageSquare, MessageSquarePlus, MoreHorizontal, NotebookPen, PanelLeftClose, PanelLeftOpen, Pencil, Pin, PinOff, Plus, Search, Settings, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type SetStateAction } from 'react';
import type { AgentProfileId, ConversationProject, TaskBoard } from '../../../contracts/desktop-bridge';
import type { ProviderConfig } from '../../../contracts/desktop-bridge';
import type { DesktopBridge } from '../../../contracts/desktop-bridge';
import { NotesNavigation } from '../../notes/notes-navigation';

export type Conversation = { id: string; projectId: string; title: string; providerId?: string; profileId?: AgentProfileId; updatedAt?: string; time?: string; archived?: boolean; pinned?: boolean };
type WorkspaceMode = 'conversation' | 'tasks' | 'notes';
type ConversationSection = 'pinned' | 'projects' | 'recent';
type SidebarSort = 'priority' | 'recent' | 'manual';
type SidebarOrganization = 'projects' | 'list';
type OpenConversationMenu = { key: string; section: ConversationSection };
type RenamingConversation = { id: string; key: string };
const INITIAL_PROJECT_CONVERSATION_LIMIT = 5;
const PROJECT_CONVERSATION_PAGE_SIZE = 10;

export function deriveConversationNavigation(conversations: Conversation[]) {
  const pinned = conversations.filter((conversation) => conversation.pinned);
  return {
    sections: (pinned.length ? ['pinned', 'projects', 'recent'] : ['projects', 'recent']) as ConversationSection[],
    pinned,
    recent: conversations.filter((conversation) => !conversation.pinned),
    projectConversations: conversations.filter((conversation) => !conversation.pinned),
  };
}

export function paginateProjectConversations(conversations: Conversation[], visibleCount = INITIAL_PROJECT_CONVERSATION_LIMIT) {
  const limit = Math.max(INITIAL_PROJECT_CONVERSATION_LIMIT, visibleCount);
  return {
    visible: conversations.slice(0, limit),
    hasMore: conversations.length > limit,
    nextVisibleCount: Math.min(conversations.length, limit + PROJECT_CONVERSATION_PAGE_SIZE),
  };
}

export function conversationMenuKey(conversationId: string, placement: string) {
  return `${placement}:${conversationId}`;
}

export function Sidebar({ conversations, projects, boards, providers, newProviderId, onNewProviderChange, activeId, activeProjectId, activeBoardId, activeNoteId, notesBridge, notesRevision, onNotesChanged, mode, settingsOpen, collapsed, appVersion, onSearch, onSelect, onSelectProject, onSelectBoard, onSelectNote, onModeChange, onNew, onRenameConversation, onMoveConversation, onArchiveConversation, onPinConversation, onDeleteConversation, onCreateProject, onRenameProject, onDeleteProject, onCreateBoard, onRenameBoard, onDeleteBoard, onReorderBoard, onMoveTaskToBoard, onSettings, onToggle }: {
  conversations: Conversation[];
  projects: ConversationProject[];
  boards: TaskBoard[];
  providers: ProviderConfig[];
  newProviderId: string;
  onNewProviderChange: (providerId: string) => void;
  activeId: string;
  activeProjectId: string;
  activeBoardId: string;
  activeNoteId: string | null;
  notesBridge?: DesktopBridge;
  notesRevision?: number;
  onNotesChanged?: () => void;
  mode: WorkspaceMode;
  settingsOpen: boolean;
  collapsed: boolean;
  appVersion?: string;
  onSearch: () => void;
  onSelect: (id: string) => void;
  onSelectProject: (id: string) => void;
  onSelectBoard: (id: string) => void;
  onSelectNote: (id: string | null) => void;
  onModeChange: (mode: WorkspaceMode) => void;
  onNew: (projectId?: string, providerId?: string) => void;
  onRenameConversation: (id: string, title: string) => Promise<void>;
  onMoveConversation: (id: string, projectId: string) => Promise<void>;
  onArchiveConversation: (id: string, archived: boolean) => Promise<void>;
  onPinConversation: (id: string, pinned: boolean) => Promise<void>;
  onDeleteConversation: (id: string) => Promise<void>;
  onCreateProject: (name: string) => Promise<void>;
  onRenameProject: (id: string, name: string) => Promise<void>;
  onDeleteProject: (id: string) => Promise<void>;
  onCreateBoard: (name: string) => Promise<void>;
  onRenameBoard: (id: string, name: string) => Promise<void>;
  onDeleteBoard: (id: string) => Promise<void>;
  onReorderBoard: (id: string, targetId: string) => Promise<void>;
  onMoveTaskToBoard: (id: string, boardId: string) => Promise<void>;
  onSettings: () => void;
  onToggle: () => void;
}) {
  const [creatingBoard, setCreatingBoard] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');
  const [renamingBoardId, setRenamingBoardId] = useState<string | null>(null);
  const [renamingBoardName, setRenamingBoardName] = useState('');
  const [boardError, setBoardError] = useState<string | null>(null);
  const [boardMenuId, setBoardMenuIdState] = useState<string | null>(null);
  const [draggedBoardId, setDraggedBoardId] = useState<string | null>(null);
  const [dragOverBoardId, setDragOverBoardId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [renamingConversation, setRenamingConversation] = useState<RenamingConversation | null>(null);
  const [renamingConversationTitle, setRenamingConversationTitle] = useState('');
  const [openConversationMenu, setOpenConversationMenuState] = useState<OpenConversationMenu | null>(null);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('yuheng-expanded-projects') ?? '{}') as Record<string, boolean>; }
    catch { return {}; }
  });
  const [projectConversationLimits, setProjectConversationLimits] = useState<Record<string, number>>({});
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renamingProjectName, setRenamingProjectName] = useState('');
  const [projectMenuId, setProjectMenuIdState] = useState<string | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Record<ConversationSection, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('yuheng-collapsed-sections') ?? '{}') as Record<ConversationSection, boolean>; }
    catch { return { pinned: false, projects: false, recent: false }; }
  });
  const [closingSections, setClosingSections] = useState<Record<string, boolean>>({});
  const sectionCloseTimers = useRef<Partial<Record<ConversationSection, number>>>({});
  const [sectionMenu, setSectionMenuState] = useState<ConversationSection | null>(null);
  const [sidebarSort, setSidebarSort] = useState<SidebarSort>(() => {
    const saved = localStorage.getItem('yuheng-sidebar-sort');
    return saved === 'recent' || saved === 'manual' ? saved : 'priority';
  });
  const [manualConversationOrder, setManualConversationOrder] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('yuheng-manual-conversation-order') ?? '[]') as string[]; }
    catch { return []; }
  });
  const [sidebarOrganization, setSidebarOrganization] = useState<SidebarOrganization>(() => localStorage.getItem('yuheng-sidebar-organization') === 'list' ? 'list' : 'projects');
  const [draggedConversationId, setDraggedConversationId] = useState<string | null>(null);
  const [dragOverProjectId, setDragOverProjectId] = useState<string | null>(null);
  const [newProviderMenuOpen, setNewProviderMenuOpenState] = useState(false);
  const [sidebarMenuClosing, setSidebarMenuClosing] = useState(false);
  const sidebarMenuCloseTimer = useRef<number | null>(null);
  const delayedMenuSetter = <T,>(current: T | null, setter: (value: T | null) => void, next: SetStateAction<T | null>) => {
    const value = typeof next === 'function' ? (next as (value: T | null) => T | null)(current) : next;
    if (sidebarMenuCloseTimer.current !== null) window.clearTimeout(sidebarMenuCloseTimer.current);
    if (value !== null) { setSidebarMenuClosing(false); setter(value); return; }
    if (current === null) return;
    setSidebarMenuClosing(true);
    sidebarMenuCloseTimer.current = window.setTimeout(() => { setter(null); setSidebarMenuClosing(false); sidebarMenuCloseTimer.current = null; }, 125);
  };
  const setSectionMenu = (next: SetStateAction<ConversationSection | null>) => delayedMenuSetter(sectionMenu, setSectionMenuState, next);
  const setProjectMenuId = (next: SetStateAction<string | null>) => delayedMenuSetter(projectMenuId, setProjectMenuIdState, next);
  const setOpenConversationMenu = (next: SetStateAction<OpenConversationMenu | null>) => delayedMenuSetter(openConversationMenu, setOpenConversationMenuState, next);
  const setBoardMenuId = (next: SetStateAction<string | null>) => delayedMenuSetter(boardMenuId, setBoardMenuIdState, next);
  const setNewProviderMenuOpen = (next: SetStateAction<boolean>) => {
    const value = typeof next === 'function' ? (next as (value: boolean) => boolean)(newProviderMenuOpen) : next;
    if (sidebarMenuCloseTimer.current !== null) window.clearTimeout(sidebarMenuCloseTimer.current);
    if (value) { setSidebarMenuClosing(false); setNewProviderMenuOpenState(true); return; }
    if (!newProviderMenuOpen) return;
    setSidebarMenuClosing(true);
    sidebarMenuCloseTimer.current = window.setTimeout(() => { setNewProviderMenuOpenState(false); setSidebarMenuClosing(false); sidebarMenuCloseTimer.current = null; }, 125);
  };

  useEffect(() => { localStorage.setItem('yuheng-expanded-projects', JSON.stringify(expandedProjects)); }, [expandedProjects]);
  useEffect(() => { localStorage.setItem('yuheng-collapsed-sections', JSON.stringify(collapsedSections)); }, [collapsedSections]);
  useEffect(() => { localStorage.setItem('yuheng-sidebar-sort', sidebarSort); }, [sidebarSort]);
  useEffect(() => { localStorage.setItem('yuheng-manual-conversation-order', JSON.stringify(manualConversationOrder)); }, [manualConversationOrder]);
  useEffect(() => { localStorage.setItem('yuheng-sidebar-organization', sidebarOrganization); }, [sidebarOrganization]);
  useEffect(() => () => {
    Object.values(sectionCloseTimers.current).forEach((timer) => { if (timer !== undefined) window.clearTimeout(timer); });
    if (sidebarMenuCloseTimer.current !== null) window.clearTimeout(sidebarMenuCloseTimer.current);
  }, []);
  useEffect(() => {
    const closeMenus = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest('.sidebar-section-menu, .sidebar-section-action, .project-menu, .project-menu-button, .conversation-menu, .conversation-menu-button, .project-create-row, .task-board-menu, .task-board-nav-rename, .sidebar-provider-picker')) return;
      setSectionMenu(null);
      setProjectMenuId(null);
      setOpenConversationMenu(null);
      setCreatingProject(false);
      setBoardMenuId(null);
      setNewProviderMenuOpen(false);
    };
    window.addEventListener('click', closeMenus);
    return () => window.removeEventListener('click', closeMenus);
  }, [sectionMenu, projectMenuId, openConversationMenu, boardMenuId, newProviderMenuOpen]);
  useEffect(() => {
    if (!activeProjectId || !projects.some((project) => project.id === activeProjectId)) return;
    setExpandedProjects((current) => current[activeProjectId] ? current : { ...current, [activeProjectId]: true });
  }, [activeProjectId, projects]);

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
  const deleteBoard = async (board: TaskBoard) => {
    if (board.id === 'default') { setBoardError('默认看板不能删除。'); setBoardMenuId(null); return; }
    if (!window.confirm(`删除看板“${board.name}”？其中的任务也会被删除。此操作无法撤销。`)) return;
    try { await onDeleteBoard(board.id); setBoardMenuId(null); setBoardError(null); }
    catch (reason) { setBoardError(reason instanceof Error ? reason.message : '删除任务看板失败。'); }
  };
  const reorderBoard = async (sourceId: string, targetId: string) => {
    if (!sourceId || sourceId === targetId) return;
    try { await onReorderBoard(sourceId, targetId); setBoardError(null); }
    catch (reason) { setBoardError(reason instanceof Error ? reason.message : '排序任务看板失败。'); }
  };
  const moveTaskToBoard = async (taskId: string, boardId: string) => {
    if (!taskId || !boardId) return;
    try {
      await onMoveTaskToBoard(taskId, boardId);
      setBoardError(null);
    } catch (reason) {
      setBoardError(reason instanceof Error ? reason.message : '移动任务失败。');
    }
  };
  const submitOnEnter = (event: KeyboardEvent<HTMLInputElement>, action: () => Promise<void>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void action();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setCreatingBoard(false);
      setRenamingBoardId(null);
      setCreatingProject(false);
      setRenamingProjectId(null);
      setRenamingConversation(null);
      setSectionMenu(null);
    }
  };
  const visibleConversations = conversations.filter((conversation) => Boolean(conversation.archived) === showArchived);
  const renameConversation = async () => {
    const id = renamingConversation?.id;
    const title = renamingConversationTitle.trim();
    setRenamingConversation(null);
    if (!id || !title) return;
    try { await onRenameConversation(id, title); setConversationError(null); }
    catch (reason) { setConversationError(reason instanceof Error ? reason.message : '重命名会话失败。'); }
  };
  const archiveConversation = async (conversation: Conversation) => {
    try { await onArchiveConversation(conversation.id, !conversation.archived); setOpenConversationMenu(null); setConversationError(null); }
    catch (reason) { setConversationError(reason instanceof Error ? reason.message : '归档会话失败。'); }
  };
  const pinConversation = async (conversation: Conversation) => {
    try { await onPinConversation(conversation.id, !conversation.pinned); setOpenConversationMenu(null); setConversationError(null); }
    catch (reason) { setConversationError(reason instanceof Error ? reason.message : '置顶会话失败。'); }
  };
  const moveConversation = async (conversation: Conversation, projectId: string) => {
    if (conversation.projectId === projectId) return;
    try { await onMoveConversation(conversation.id, projectId); setExpandedProjects((current) => ({ ...current, [projectId]: true })); setOpenConversationMenu(null); setConversationError(null); }
    catch (reason) { setConversationError(reason instanceof Error ? reason.message : '移动会话失败。'); }
  };
  const deleteConversation = async (conversation: Conversation) => {
    if (!window.confirm(`删除“${conversation.title}”及其所有消息和运行记录？此操作无法撤销。`)) return;
    try { await onDeleteConversation(conversation.id); setOpenConversationMenu(null); setConversationError(null); }
    catch (reason) { setConversationError(reason instanceof Error ? reason.message : '删除会话失败。'); }
  };
  const createProject = async () => {
    const name = newProjectName.trim();
    if (!name) return;
    try { await onCreateProject(name); setNewProjectName(''); setCreatingProject(false); setProjectError(null); }
    catch (reason) { setProjectError(reason instanceof Error ? reason.message : '新建项目失败。'); }
  };
  const renameProject = async () => {
    const id = renamingProjectId;
    const name = renamingProjectName.trim();
    setRenamingProjectId(null);
    if (!id || !name) return;
    try { await onRenameProject(id, name); setProjectMenuId(null); setProjectError(null); }
    catch (reason) { setProjectError(reason instanceof Error ? reason.message : '修改项目名称失败。'); }
  };
  const deleteProject = async (project: ConversationProject) => {
    if (!window.confirm(`删除项目“${project.name}”？其中的会话会移入“个人事务”。`)) return;
    try { await onDeleteProject(project.id); setProjectMenuId(null); setProjectError(null); }
    catch (reason) { setProjectError(reason instanceof Error ? reason.message : '删除项目失败。'); }
  };
  const orderedConversations = (items: Conversation[]) => [...items].sort((left, right) => {
    if (sidebarSort === 'manual') {
      const leftIndex = manualConversationOrder.indexOf(left.id);
      const rightIndex = manualConversationOrder.indexOf(right.id);
      if (leftIndex < 0 && rightIndex < 0) return 0;
      if (leftIndex < 0) return 1;
      if (rightIndex < 0) return -1;
      return leftIndex - rightIndex;
    }
    if (sidebarSort === 'priority') return Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) || (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '');
    return (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '');
  });
  const toggleSection = (section: ConversationSection) => {
    const isCollapsed = collapsedSections[section];
    if (sectionCloseTimers.current[section] !== undefined) window.clearTimeout(sectionCloseTimers.current[section]);
    if (isCollapsed) {
      setClosingSections((current) => ({ ...current, [section]: false }));
      setCollapsedSections((current) => ({ ...current, [section]: false }));
    } else {
      setCollapsedSections((current) => ({ ...current, [section]: true }));
      setClosingSections((current) => ({ ...current, [section]: true }));
      sectionCloseTimers.current[section] = window.setTimeout(() => {
        setClosingSections((current) => ({ ...current, [section]: false }));
        delete sectionCloseTimers.current[section];
      }, 165);
    }
    setSectionMenu(null);
  };
  const reorderConversation = (sourceId: string, targetId: string) => {
    if (!sourceId || sourceId === targetId) return;
    const currentIds = conversations.map((conversation) => conversation.id);
    setManualConversationOrder((stored) => {
      const order = [...stored.filter((id) => currentIds.includes(id)), ...currentIds.filter((id) => !stored.includes(id))];
      const sourceIndex = order.indexOf(sourceId);
      const targetIndex = order.indexOf(targetId);
      if (sourceIndex < 0 || targetIndex < 0) return order;
      order.splice(targetIndex, 0, order.splice(sourceIndex, 1)[0]);
      return order;
    });
  };
  const conversationNavigation = deriveConversationNavigation(orderedConversations(visibleConversations));
  const conversationsForProject = (projectId: string) => conversationNavigation.projectConversations.filter((conversation) => conversation.projectId === projectId);
  const renderConversation = (conversation: Conversation, placement: string, section: ConversationSection) => {
    const menuKey = conversationMenuKey(conversation.id, placement);
    return (
    <div className={`conversation-row ${!settingsOpen && activeId === conversation.id ? 'is-selected' : ''} ${sidebarSort === 'manual' ? 'is-sortable' : ''} ${draggedConversationId === conversation.id ? 'is-dragging' : ''}`} key={conversation.id} draggable={!collapsed} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/yuheng-conversation', conversation.id); setDraggedConversationId(conversation.id); }} onDragEnd={() => { setDraggedConversationId(null); setDragOverProjectId(null); }} onDragOver={(event) => { if (sidebarSort === 'manual') { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }} onDrop={(event) => { event.preventDefault(); reorderConversation(event.dataTransfer.getData('text/yuheng-conversation'), conversation.id); setDraggedConversationId(null); setDragOverProjectId(null); }}>
      {renamingConversation?.key === menuKey && !collapsed ? <input className="conversation-rename-input" autoFocus value={renamingConversationTitle} onChange={(event) => setRenamingConversationTitle(event.target.value)} onBlur={() => void renameConversation()} onKeyDown={(event) => submitOnEnter(event, renameConversation)} aria-label="会话名称" /> : <><button type="button" className="conversation-item" onClick={() => onSelect(conversation.id)} title={conversation.title}><span className="conversation-title">{collapsed ? conversation.title.slice(0, 1) : conversation.title}</span>{!collapsed && <time>{conversation.time ?? (conversation.updatedAt ? new Date(conversation.updatedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '')}</time>}</button>{!collapsed && <button type="button" className="conversation-menu-button" onClick={() => setOpenConversationMenu((current) => current?.key === menuKey ? null : { key: menuKey, section })} aria-expanded={openConversationMenu?.key === menuKey} aria-label={`管理${conversation.title}`} title="管理会话"><MoreHorizontal size={15} /></button>}{openConversationMenu?.key === menuKey && !collapsed && <div className="conversation-menu"><button type="button" onClick={() => { setRenamingConversation({ id: conversation.id, key: menuKey }); setRenamingConversationTitle(conversation.title); setOpenConversationMenu(null); }}><Pencil size={13} />重命名</button><button type="button" onClick={() => void pinConversation(conversation)}>{conversation.pinned ? <PinOff size={13} /> : <Pin size={13} />}{conversation.pinned ? '取消置顶' : '置顶'}</button>{projects.filter((item) => item.id !== conversation.projectId).map((item) => <button type="button" key={item.id} onClick={() => void moveConversation(conversation, item.id)}><Folder size={13} />移至 {item.name}</button>)}<button type="button" onClick={() => void archiveConversation(conversation)}>{conversation.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}{conversation.archived ? '恢复归档' : '归档'}</button><button type="button" className="is-destructive" onClick={() => void deleteConversation(conversation)}><Trash2 size={13} />删除</button></div>}</>}
    </div>
    );
  };
  const renderProject = (project: ConversationProject) => {
    const projectConversations = conversationsForProject(project.id);
    const isExpanded = sidebarOrganization === 'projects' && (expandedProjects[project.id] ?? (project.id === activeProjectId));
    const projectPage = paginateProjectConversations(projectConversations, projectConversationLimits[project.id]);
    const toggleProject = () => {
      onSelectProject(project.id);
      if (sidebarOrganization !== 'projects') return;
      setExpandedProjects((current) => ({ ...current, [project.id]: !isExpanded }));
      setProjectConversationLimits((current) => ({ ...current, [project.id]: INITIAL_PROJECT_CONVERSATION_LIMIT }));
    };
    return <div className={`project-group ${project.id === activeProjectId && !settingsOpen ? 'is-active' : ''} ${dragOverProjectId === project.id ? 'is-drop-target' : ''}`} key={project.id} onDragOver={(event) => { if (!draggedConversationId) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOverProjectId(project.id); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOverProjectId(null); }} onDrop={(event) => { event.preventDefault(); const conversationId = event.dataTransfer.getData('text/yuheng-conversation'); const conversation = conversations.find((item) => item.id === conversationId); setDragOverProjectId(null); setDraggedConversationId(null); if (conversation) void moveConversation(conversation, project.id); }}>
      <div className="project-row" title={draggedConversationId ? `移至${project.name}` : undefined}>
        {renamingProjectId === project.id && !collapsed ? <input className="project-rename-input" autoFocus value={renamingProjectName} onChange={(event) => setRenamingProjectName(event.target.value)} onBlur={() => void renameProject()} onKeyDown={(event) => submitOnEnter(event, renameProject)} aria-label="项目名称" /> : <>
          <button type="button" className="project-select" onClick={toggleProject} title={project.name} aria-expanded={isExpanded}>{isExpanded ? <FolderOpen size={15} /> : <Folder size={15} />} {!collapsed && <span>{project.name}</span>}</button>
          {!collapsed && <button type="button" className="project-menu-button" onClick={() => setProjectMenuId((current) => current === project.id ? null : project.id)} aria-expanded={projectMenuId === project.id} aria-label={`管理${project.name}`} title="管理项目"><MoreHorizontal size={15} /></button>}
          {projectMenuId === project.id && !collapsed && <div className="project-menu"><button type="button" onClick={() => { setRenamingProjectId(project.id); setRenamingProjectName(project.name); setProjectMenuId(null); }}><Pencil size={13} />重命名</button>{project.id !== 'personal' && <button type="button" className="is-destructive" onClick={() => void deleteProject(project)}><Trash2 size={13} />删除项目</button>}</div>}
        </>}
      </div>
      {isExpanded && !collapsed && <div className="project-conversations">{projectPage.visible.map((conversation) => renderConversation(conversation, `project:${project.id}`, 'projects'))}{!projectConversations.length && <div className="project-empty">暂无会话</div>}{projectPage.hasMore && <button type="button" className="project-show-more" onClick={() => setProjectConversationLimits((current) => ({ ...current, [project.id]: projectPage.nextVisibleCount }))}>展开显示</button>}</div>}
    </div>;
  };

  return (
    <aside className={`sidebar ${sidebarMenuClosing ? 'sidebar-menu-closing' : ''}`} aria-label="工作区导航" data-collapsed={collapsed}>
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
        <button type="button" role="tab" aria-selected={mode === 'notes'} className={mode === 'notes' ? 'is-selected' : ''} onClick={() => onModeChange('notes')} title="笔记">
          <NotebookPen size={15} aria-hidden="true" />{mode === 'notes' && <span>笔记</span>}
        </button>
      </div>

      <div key={mode} className={`sidebar-mode-content is-${mode}`}>
      {mode === 'conversation' ? <>
        <nav className="conversation-list" aria-label="最近会话">
          {conversationNavigation.sections.map((section) => {
            const isCollapsed = collapsedSections[section];
            const label = section === 'pinned' ? '置顶' : section === 'projects' ? '项目' : '最近';
            const sectionConversations = section === 'pinned' ? conversationNavigation.pinned : conversationNavigation.recent;
            return <section className={`sidebar-section sidebar-section-${section} ${isCollapsed ? 'is-collapsed' : ''} ${openConversationMenu?.section === section ? 'has-open-menu' : ''}`} key={section}>
              <div className="sidebar-section-heading">
                <button type="button" className="sidebar-section-toggle" onClick={() => toggleSection(section)} aria-expanded={!isCollapsed} title={`${isCollapsed ? '展开' : '收起'}${label}`}><span>{label}</span><ChevronDown size={14} /></button>
                {!collapsed && <div className="sidebar-section-actions"><button type="button" className="sidebar-section-action" onClick={(event) => { event.stopPropagation(); setSectionMenu((current) => current === section ? null : section); }} aria-expanded={sectionMenu === section} aria-label={`整理${label}`} title={`整理${label}`}><MoreHorizontal size={16} /></button>{section === 'projects' && <button type="button" className="sidebar-section-action" onClick={(event) => { event.stopPropagation(); setSectionMenu(null); setCreatingProject(true); setCollapsedSections((current) => ({ ...current, projects: false })); }} aria-label="新建项目" title="新建项目"><Plus size={16} /></button>}</div>}
                {sectionMenu === section && !collapsed && <div className="sidebar-section-menu"><div className="sidebar-section-menu-label">整理侧边栏</div>{(['projects', 'list'] as SidebarOrganization[]).map((organization) => <button type="button" key={organization} onClick={() => { setSidebarOrganization(organization); setSectionMenu(null); }}><span>{sidebarOrganization === organization ? <Check size={14} /> : <span className="sidebar-menu-placeholder" />}</span>{organization === 'projects' ? '按项目' : '在一个列表中'}</button>)}<div className="sidebar-section-menu-label">聊天排序方式</div>{(['priority', 'recent', 'manual'] as SidebarSort[]).map((sort) => <button type="button" key={sort} onClick={() => { setSidebarSort(sort); setSectionMenu(null); }}><span>{sidebarSort === sort ? <Check size={14} /> : <span className="sidebar-menu-placeholder" />}</span>{sort === 'priority' ? '优先级' : sort === 'recent' ? '最近更新' : '手动排序'}</button>)}<div className="sidebar-section-menu-separator" /><button type="button" onClick={() => { setShowArchived((current) => !current); setSectionMenu(null); }}><span>{showArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}</span>{showArchived ? '返回进行中' : '查看已归档'}</button></div>}
              </div>
              {(!isCollapsed || closingSections[section]) && <div className={`sidebar-section-content ${isCollapsed ? 'is-closing' : ''}`}>
                {section === 'projects' ? <>{creatingProject && !collapsed && <div className="project-create-row"><Folder size={15} /><input autoFocus value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} onBlur={() => { if (!newProjectName.trim()) setCreatingProject(false); }} onKeyDown={(event) => submitOnEnter(event, createProject)} placeholder="项目名称" aria-label="新项目名称" /><button type="button" onClick={() => void createProject()} disabled={!newProjectName.trim()}>添加</button></div>}{projects.map(renderProject)}{!projects.length && <div className="conversation-list-empty">暂无项目</div>}</> : sectionConversations.length ? sectionConversations.map((conversation) => renderConversation(conversation, `section:${section}`, section)) : <div className="conversation-list-empty">{showArchived ? '暂无已归档会话' : '暂无最近会话'}</div>}
              </div>}
            </section>;
          })}
        </nav>
        {projectError && !collapsed && <p className="sidebar-board-error" role="alert">{projectError}</p>}
        {conversationError && !collapsed && <p className="sidebar-board-error" role="alert">{conversationError}</p>}
      </> : mode === 'tasks' ? <>
        <div className="task-board-list-heading">
          {!collapsed && <span>任务看板</span>}
          <button type="button" onClick={() => { if (collapsed) onToggle(); setCreatingBoard(true); }} aria-label="新建任务看板" title="新建任务看板"><Plus size={14} /></button>
        </div>
        <nav className="task-board-list" aria-label="任务看板">
          {boards.map((board) => <div className={`task-board-nav-row ${!settingsOpen && activeBoardId === board.id ? 'is-selected' : ''} ${dragOverBoardId === board.id ? 'is-drop-target' : ''} ${draggedBoardId === board.id ? 'is-dragging' : ''}`} key={board.id} draggable={!collapsed} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/yuheng-board', board.id); setDraggedBoardId(board.id); }} onDragEnd={() => { setDraggedBoardId(null); setDragOverBoardId(null); }} onDragOver={(event) => { const taskDrag = event.dataTransfer.types.includes('text/task-id') || event.dataTransfer.types.includes('text/plain'); if (taskDrag) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOverBoardId(board.id); return; } if (!draggedBoardId) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOverBoardId(board.id); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOverBoardId(null); }} onDrop={(event) => { event.preventDefault(); const taskId = event.dataTransfer.getData('text/task-id') || event.dataTransfer.getData('text/plain'); const sourceId = event.dataTransfer.getData('text/yuheng-board'); setDraggedBoardId(null); setDragOverBoardId(null); if (taskId) { void moveTaskToBoard(taskId, board.id); return; } void reorderBoard(sourceId, board.id); }} onContextMenu={(event) => { if (collapsed) return; event.preventDefault(); setBoardMenuId((current) => current === board.id ? null : board.id); }}>
            {renamingBoardId === board.id && !collapsed ? <input autoFocus value={renamingBoardName} onChange={(event) => setRenamingBoardName(event.target.value)} onBlur={() => void renameBoard()} onKeyDown={(event) => submitOnEnter(event, renameBoard)} aria-label="任务看板名称" /> : <>
              <button type="button" className="task-board-nav-select" onClick={() => onSelectBoard(board.id)} title={board.name}>
                <LayoutDashboard size={15} aria-hidden="true" />
                {!collapsed && <span>{board.name}</span>}
              </button>
              {!collapsed && <button type="button" className="task-board-nav-rename" onClick={(event) => { event.stopPropagation(); setBoardMenuId((current) => current === board.id ? null : board.id); }} aria-expanded={boardMenuId === board.id} aria-label={`编辑${board.name}`} title="编辑看板"><Pencil size={12} /></button>}
              {boardMenuId === board.id && !collapsed && <div className="task-board-menu"><button type="button" onClick={() => { setRenamingBoardId(board.id); setRenamingBoardName(board.name); setBoardMenuId(null); }}><Pencil size={13} />重命名</button><button type="button" className="is-destructive" onClick={() => void deleteBoard(board)}><Trash2 size={13} />删除看板</button></div>}
            </>}
          </div>)}
          {creatingBoard && !collapsed && <div className="task-board-create-row"><LayoutDashboard size={15} /><input autoFocus value={newBoardName} onChange={(event) => setNewBoardName(event.target.value)} onBlur={() => { if (!newBoardName.trim()) setCreatingBoard(false); }} onKeyDown={(event) => submitOnEnter(event, createBoard)} placeholder="看板名称" aria-label="新任务看板名称" /><button type="button" onClick={() => void createBoard()} disabled={!newBoardName.trim()}>添加</button></div>}
          {boardError && !collapsed && <p className="sidebar-board-error" role="alert">{boardError}</p>}
        </nav>
      </> : <NotesNavigation bridge={notesBridge} activeNoteId={activeNoteId} refreshKey={notesRevision} onSelect={onSelectNote} onChanged={onNotesChanged} />}
      </div>

      <div className="sidebar-bottom">
        {mode === 'conversation' && <div className="sidebar-new-chat">
          {!collapsed && providers.length > 0 && <div className="sidebar-provider-picker"><span>新会话使用</span><span className="sidebar-provider-control"><button type="button" className="sidebar-provider-trigger" aria-haspopup="listbox" aria-expanded={newProviderMenuOpen} aria-label={`新会话使用的 Provider：${providers.find((provider) => provider.id === newProviderId)?.displayName ?? '未选择'}`} onClick={() => setNewProviderMenuOpen((current) => !current)}><span>{providers.find((provider) => provider.id === newProviderId)?.displayName ?? '未选择'}</span><ChevronDown size={13} aria-hidden="true" /></button>{newProviderMenuOpen && <span className="sidebar-provider-menu" role="listbox" aria-label="选择新会话 Provider">{providers.map((provider) => <button type="button" role="option" aria-selected={provider.id === newProviderId} className={`${provider.id === newProviderId ? 'is-selected' : ''} ${provider.hasApiKey ? '' : 'is-disabled'}`} key={provider.id} disabled={!provider.hasApiKey} onClick={() => { setNewProviderMenuOpen(false); onNewProviderChange(provider.id); }}><span>{provider.displayName}</span>{provider.id === newProviderId && <span aria-hidden="true">✓</span>}</button>)}</span>}</span></div>}
          <button type="button" className="primary-action" onClick={() => onNew(activeProjectId)} aria-label="新会话" title="新会话">
            <MessageSquarePlus size={17} aria-hidden="true" />
            {!collapsed && <span>新会话</span>}
          </button>
        </div>}
        <div className="sidebar-settings-area">
          <button type="button" className={`workspace-nav-item ${settingsOpen ? 'is-selected' : ''}`} onClick={onSettings} aria-current={settingsOpen ? 'page' : undefined} title="设置">
            <Settings size={16} aria-hidden="true" /><span>设置</span>{appVersion && <small className="sidebar-version">v{appVersion}</small>}
          </button>
        </div>
      </div>
    </aside>
  );
}
