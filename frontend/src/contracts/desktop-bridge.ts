export type ProviderProtocol = 'openai' | 'anthropic';
export type AppInfo = { name: string; version: string; platform: string; arch: string };
export type ReasoningLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ReasoningSelection = 'default' | ReasoningLevel;
export type ProviderConfig = { id: string; protocol: ProviderProtocol; baseUrl: string; model: string; displayName: string; contextWindow: number; hasApiKey: boolean };
export type ProviderTestResult = { ok: boolean; status: number | null; latencyMs: number; error?: string };
export type AgentProfileId = 'assistant' | 'analyst' | 'auditor';
export type AgentProfile = { id: AgentProfileId; name: string; description: string; timeContext: 'full' | 'none' };
export const AGENT_PROFILES: readonly AgentProfile[] = [
  { id: 'assistant', name: '助手', description: '处理日常事务、任务和计划', timeContext: 'full' },
  { id: 'analyst', name: '分析师', description: '整理资料、比较信息和推导结论', timeContext: 'none' },
  { id: 'auditor', name: '审计专家', description: '核验事实、证据和变更记录', timeContext: 'none' },
];
export const DEFAULT_AGENT_PROFILE_ID: AgentProfileId = 'assistant';
export type BrowserUseConfig = { enabled: boolean };
export type ComputerUseConfig = { enabled: boolean };
export type DesktopPetConfig = { enabled: boolean; petId?: string; scale?: number };
export type CodexPetManifest = { id: string; displayName: string; description?: string; spritesheetPath: string; spriteVersionNumber?: number; source: 'codex' | 'yuheng'; columns: number; rows: number; cellWidth: number; cellHeight: number };
export type ConversationProject = { id: string; name: string; position: number };
export type Conversation = { id: string; projectId: string; title: string; updatedAt: string; archived: boolean; pinned: boolean; providerId?: string; profileId: AgentProfileId };
export type Message = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string };
export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type RunArtifact = { id: string; kind: 'browser_screenshot' | 'computer_screenshot'; mimeType: string; size: number; url: string };
export type RunActivity = { id: string; toolName: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; input: string | null; output: string | null; startedAt: string; finishedAt: string | null; artifacts: RunArtifact[] };
export type RunUsage = { inputTokens: number; outputTokens: number; totalTokens: number; contextTokens: number | null; contextWindow: number; contextPercent: number | null };
export type RunSummary = { id: string; conversationId: string; status: RunStatus; error: string | null; startedAt: string; finishedAt: string | null; inputMessageId: string | null; usage: RunUsage | null; activities: RunActivity[] };
export type Attachment = { id: string; name: string; mimeType: string; size: number };
export type TaskBoard = { id: string; name: string; position: number };
export type TaskStatus = string;
export type TaskType = { id: string; boardId: string; name: string; position: number };
export type TaskPriority = 'low' | 'medium' | 'high';
export type Task = { id: string; boardId: string; title: string; description: string; status: TaskStatus; priority: TaskPriority; dueAt: string | null; remindAt: string | null; reminderFiredAt: string | null; sourceConversationId: string | null; createdAt: string; updatedAt: string };
export type Note = { id: string; parentId: string | null; title: string; content: string; icon: string | null; cover: string | null; position: number; archived: boolean; createdAt: string; updatedAt: string };
export type NoteCover = { id: string; mimeType: string; size: number; url: string };
export type CreateTaskInput = Pick<Task, 'title'> & Partial<Pick<Task, 'description' | 'status' | 'priority' | 'dueAt' | 'remindAt' | 'sourceConversationId'>>;
export type UpdateTaskInput = Partial<Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'dueAt' | 'remindAt'>>;
export type SearchResultKind = 'conversation' | 'message' | 'task' | 'board' | 'note';
export type SearchResult = { kind: SearchResultKind; id: string; parentId: string | null; title: string; snippet: string; context: string; updatedAt: string; archived: boolean };
export type TaskEvent = { type: 'changed'; task: Task } | { type: 'types_changed'; boardId: string } | { type: 'boards_changed' } | { type: 'open'; boardId: string; taskId: string };
export type TaskAsset = { id: string; name: string; mimeType: string; size: number; url: string };
export type RunEvent =
  | { type: 'accepted'; runId: string; conversationId: string }
  | { type: 'delta'; runId: string; conversationId: string; messageId: string; delta: string; createdAt: string }
  | { type: 'tool_start'; runId: string; conversationId: string; toolCallId: string; toolName: string; input?: string }
  | { type: 'tool_end'; runId: string; conversationId: string; toolCallId: string; toolName: string; isError: boolean; output?: string; artifacts: RunArtifact[] }
  | { type: 'approval_required'; runId: string; conversationId: string; approvalId: string; toolCallId: string; toolName: string; input?: string }
  | { type: 'approval_resolved'; runId: string; conversationId: string; approvalId: string; approved: boolean }
  | { type: 'completed'; runId: string; conversationId: string; messageId: string }
  | { type: 'failed'; runId: string; conversationId: string; error: string }
  | { type: 'cancelled'; runId: string; conversationId: string };

export type DesktopBridge = {
  app: {
    getInfo: () => Promise<AppInfo>;
    openExternal: (url: string) => Promise<void>;
    onFullscreen: (listener: (fullscreen: boolean) => void) => () => void;
  };
  backup: {
    export: () => Promise<string | null>;
    import: () => Promise<{ conversations: number; messages: number; tasks: number; notes: number; missingProviders: number; contextUnavailable: boolean } | null>;
    getConfig: () => Promise<{ enabled: boolean; directory: string; retention: number; lastRunAt: string | null; lastError: string | null }>;
    saveConfig: (config: { enabled: boolean; directory: string; retention: number }) => Promise<{ enabled: boolean; directory: string; retention: number; lastRunAt: string | null; lastError: string | null }>;
  };
  desktopPresence: {
    getConfig: () => Promise<{ notificationsEnabled: boolean; menuBarEnabled: boolean }>;
    saveConfig: (config: { notificationsEnabled: boolean; menuBarEnabled: boolean }) => Promise<{ notificationsEnabled: boolean; menuBarEnabled: boolean }>;
  };
  search: {
    query: (text: string, limit?: number) => Promise<SearchResult[]>;
  };
  conversations: {
    list: (includeArchived?: boolean) => Promise<Conversation[]>;
    projects: {
      list: () => Promise<ConversationProject[]>;
      create: (name: string) => Promise<ConversationProject>;
      rename: (projectId: string, name: string) => Promise<ConversationProject>;
      delete: (projectId: string) => Promise<void>;
    };
    messages: (conversationId: string) => Promise<Message[]>;
    branch: (conversationId: string, messageId: string) => Promise<Conversation>;
    create: (title?: string, projectId?: string, providerId?: string, profileId?: AgentProfileId) => Promise<Conversation>;
    setProvider: (conversationId: string, providerId: string) => Promise<Conversation>;
    setProfile: (conversationId: string, profileId: AgentProfileId) => Promise<Conversation>;
    rename: (conversationId: string, title: string) => Promise<Conversation>;
    move: (conversationId: string, projectId: string) => Promise<Conversation>;
    archive: (conversationId: string, archived: boolean) => Promise<Conversation>;
    pin: (conversationId: string, pinned: boolean) => Promise<Conversation>;
    delete: (conversationId: string) => Promise<void>;
    export: (conversationId: string) => Promise<string | null>;
    import: () => Promise<Conversation | null>;
  };
  provider: {
    get: () => Promise<ProviderConfig | null>;
    list: () => Promise<ProviderConfig[]>;
    save: (config: { id?: string; protocol: ProviderProtocol; baseUrl: string; model: string; displayName: string; contextWindow: number; apiKey: string }) => Promise<ProviderConfig>;
    delete: (providerId: string) => Promise<void>;
    test: (config: { id?: string; protocol: ProviderProtocol; baseUrl: string; model: string; displayName?: string; contextWindow?: number; apiKey?: string }) => Promise<ProviderTestResult>;
  };
  browserUse: {
    get: () => Promise<BrowserUseConfig>;
    save: (config: BrowserUseConfig) => Promise<BrowserUseConfig>;
  };
  computerUse: {
    get: () => Promise<ComputerUseConfig>;
    save: (config: ComputerUseConfig) => Promise<ComputerUseConfig>;
  };
  pet: {
    get: () => Promise<DesktopPetConfig>;
    list: () => Promise<CodexPetManifest[]>;
    asset: (petId: string) => Promise<{ manifest: CodexPetManifest; dataUrl: string } | null>;
    openFolder: () => Promise<void>;
    save: (config: DesktopPetConfig) => Promise<DesktopPetConfig>;
    focusMain: () => Promise<void>;
    beginDrag: (screenX: number, screenY: number) => void;
    dragTo: (screenX: number, screenY: number) => void;
    endDrag: () => void;
    onState: (listener: (state: 'idle' | 'working' | 'celebrate') => void) => () => void;
    onConfig: (listener: (config: DesktopPetConfig) => void) => () => void;
  };
  reasoning: {
    get: (conversationId: string) => Promise<ReasoningSelection>;
    save: (conversationId: string, level: ReasoningSelection) => Promise<ReasoningSelection>;
  };
  attachments: {
    pick: () => Promise<Attachment[]>;
    release: (attachmentIds: string[]) => Promise<void>;
  };
  tasks: {
    boards: {
      list: () => Promise<TaskBoard[]>;
      create: (name: string) => Promise<TaskBoard>;
      rename: (id: string, name: string) => Promise<TaskBoard>;
      reorder: (id: string, targetId: string) => Promise<TaskBoard[]>;
      delete: (id: string) => Promise<void>;
    };
    list: (boardId: string) => Promise<Task[]>;
    takeOpenRequest: () => Promise<{ boardId: string; taskId: string } | null>;
    types: {
      list: (boardId: string) => Promise<TaskType[]>;
      create: (boardId: string, name: string) => Promise<TaskType>;
      rename: (id: string, name: string) => Promise<TaskType>;
      delete: (id: string) => Promise<void>;
    };
    create: (boardId: string, input: CreateTaskInput) => Promise<Task>;
    update: (id: string, patch: UpdateTaskInput) => Promise<Task>;
    reorder: (id: string, targetId: string) => Promise<Task[]>;
    moveToBoard: (id: string, boardId: string) => Promise<Task>;
    copyToBoard: (id: string, boardId: string) => Promise<Task>;
    delete: (id: string) => Promise<void>;
    onEvent: (listener: (event: TaskEvent) => void) => () => void;
    assets: {
      import: (input: { name: string; mimeType: string; data: ArrayBuffer }) => Promise<TaskAsset>;
      pick: () => Promise<TaskAsset[]>;
      open: (url: string) => Promise<void>;
    };
  };
  notes: {
    list: (includeArchived?: boolean) => Promise<Note[]>;
    get: (id: string) => Promise<Note | null>;
    create: (title?: string, parentId?: string | null) => Promise<Note>;
    update: (id: string, patch: { title?: string; content?: string; archived?: boolean; icon?: string | null; cover?: string | null }) => Promise<Note>;
    move: (id: string, parentId: string | null, targetId?: string) => Promise<Note>;
    delete: (id: string) => Promise<void>;
    covers: { pick: () => Promise<NoteCover | null> };
  };
  runs: {
    list: (conversationId: string) => Promise<RunSummary[]>;
    start: (conversationId: string, content: string, attachmentIds?: string[], reasoningLevel?: ReasoningLevel) => Promise<{ runId: string; userMessage: Message; conversation: Conversation }>;
    retry: (conversationId: string, inputMessageId: string, content: string, reasoningLevel?: ReasoningLevel) => Promise<{ runId: string; userMessage: Message; conversation: Conversation }>;
    cancel: (runId: string) => Promise<void>;
    approve: (approvalId: string, approved: boolean) => Promise<void>;
    onEvent: (listener: (event: RunEvent) => void) => () => void;
  };
};
