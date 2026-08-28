export type ProviderProtocol = 'openai' | 'anthropic';
export type AppInfo = { name: string; version: string; platform: string; arch: string };
export type ReasoningLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ReasoningSelection = 'default' | ReasoningLevel;
export type ProviderConfig = { protocol: ProviderProtocol; baseUrl: string; model: string; displayName: string; contextWindow: number; hasApiKey: boolean };
export type BrowserUseConfig = { enabled: boolean };
export type ComputerUseConfig = { enabled: boolean };
export type ConversationProject = { id: string; name: string; position: number };
export type Conversation = { id: string; projectId: string; title: string; updatedAt: string; archived: boolean; pinned: boolean };
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
export type CreateTaskInput = Pick<Task, 'title'> & Partial<Pick<Task, 'description' | 'status' | 'priority' | 'dueAt' | 'remindAt' | 'sourceConversationId'>>;
export type UpdateTaskInput = Partial<Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'dueAt' | 'remindAt'>>;
export type SearchResultKind = 'conversation' | 'message' | 'task' | 'board';
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
    create: (title?: string, projectId?: string) => Promise<Conversation>;
    rename: (conversationId: string, title: string) => Promise<Conversation>;
    move: (conversationId: string, projectId: string) => Promise<Conversation>;
    archive: (conversationId: string, archived: boolean) => Promise<Conversation>;
    pin: (conversationId: string, pinned: boolean) => Promise<Conversation>;
    delete: (conversationId: string) => Promise<void>;
  };
  provider: {
    get: () => Promise<ProviderConfig | null>;
    save: (config: { protocol: ProviderProtocol; baseUrl: string; model: string; displayName: string; contextWindow: number; apiKey: string }) => Promise<ProviderConfig>;
  };
  browserUse: {
    get: () => Promise<BrowserUseConfig>;
    save: (config: BrowserUseConfig) => Promise<BrowserUseConfig>;
  };
  computerUse: {
    get: () => Promise<ComputerUseConfig>;
    save: (config: ComputerUseConfig) => Promise<ComputerUseConfig>;
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
    };
    list: (boardId: string) => Promise<Task[]>;
    takeOpenRequest: () => Promise<{ boardId: string; taskId: string } | null>;
    types: {
      list: (boardId: string) => Promise<TaskType[]>;
      create: (boardId: string, name: string) => Promise<TaskType>;
      rename: (id: string, name: string) => Promise<TaskType>;
    };
    create: (boardId: string, input: CreateTaskInput) => Promise<Task>;
    update: (id: string, patch: UpdateTaskInput) => Promise<Task>;
    onEvent: (listener: (event: TaskEvent) => void) => () => void;
    assets: {
      import: (input: { name: string; mimeType: string; data: ArrayBuffer }) => Promise<TaskAsset>;
      pick: () => Promise<TaskAsset[]>;
      open: (url: string) => Promise<void>;
    };
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
