export type ProviderProtocol = 'openai' | 'anthropic';
export type AppInfo = { name: string; version: string; platform: string; arch: string };
export type ReasoningLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ReasoningSelection = 'default' | ReasoningLevel;
export type ToolPermissionMode = 'cautious' | 'smart' | 'full_session';
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
export type PetFeedbackMode = 'important' | 'all' | 'hidden';
export type DesktopPetConfig = { enabled: boolean; petId?: string; scale?: number; locked?: boolean; opacity?: number; alwaysOnTop?: boolean; edgeSnap?: boolean; inertia?: boolean; boundaryBounce?: boolean; feedbackMode?: PetFeedbackMode; completionFeedback?: boolean; errorFeedback?: boolean; approvalFeedback?: boolean; soundEnabled?: boolean; mutedUntil?: number };
export type PetState = 'idle' | 'thinking' | 'working' | 'attention' | 'error' | 'celebrate';
export type PetOpenTarget =
  | { kind: 'conversation'; conversationId: string; runId?: string; messageId?: string }
  | { kind: 'run'; conversationId: string; runId: string }
  | { kind: 'approval'; conversationId: string; runId: string; approvalId: string }
  | { kind: 'task'; boardId: string; taskId: string };
export type PetFeedback = { state: PetState; label: string; kind?: 'task_reminder'; detail?: string; conversationId?: string; runId?: string; toolName?: string; openTarget?: PetOpenTarget };
export type PetAnimation = { row: number; durations: readonly number[] };
export type CodexPetManifest = { id: string; displayName: string; description?: string; spritesheetPath: string; spriteVersionNumber?: number; source: 'codex' | 'yuheng'; columns: number; rows: number; cellWidth: number; cellHeight: number; animations?: Partial<Record<PetState, PetAnimation>> };
export type CodexPetValidationIssue = { code: 'dimensions' | 'blank_frames' | 'frame_rate' | 'missing_states' | 'manifest'; severity: 'error' | 'warning'; message: string };
export type CodexPetStateReport = { state: PetState; row: number; frameCount: number; frameDurationMs: number; source: 'manifest' | 'default'; fallback: boolean };
export type CodexPetCompatibilityReport = { status: 'compatible' | 'warning' | 'invalid'; expected: { width: number; height: number }; actual: { width: number; height: number }; states: CodexPetStateReport[]; issues: CodexPetValidationIssue[] };
export type CodexPetCatalogEntry = { id: string; displayName: string; description?: string; source: 'codex' | 'yuheng'; manifest?: CodexPetManifest; report: CodexPetCompatibilityReport };
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
export type NoteProperties = { status: string | null; date: string | null; tags: string[] };
export type Note = { id: string; parentId: string | null; title: string; content: string; icon: string | null; cover: string | null; properties: NoteProperties; position: number; archived: boolean; favorite: boolean; lastOpenedAt: string | null; createdAt: string; updatedAt: string };
export type NoteVersion = { id: string; noteId: string; title: string; content: string; icon: string | null; cover: string | null; properties: NoteProperties; createdAt: string };
export type NoteCover = { id: string; mimeType: string; size: number; url: string };
export type CreateNoteInput = { title?: string; parentId?: string | null; content?: string; icon?: string | null };
export type CreateTaskInput = Pick<Task, 'title'> & Partial<Pick<Task, 'description' | 'status' | 'priority' | 'dueAt' | 'remindAt' | 'sourceConversationId'>>;
export type UpdateTaskInput = Partial<Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'dueAt' | 'remindAt'>>;
export type SearchResultKind = 'conversation' | 'message' | 'task' | 'board' | 'note';
export type SearchResult = { kind: SearchResultKind; id: string; parentId: string | null; title: string; snippet: string; context: string; updatedAt: string; archived: boolean };
export type TaskEvent =
  | { type: 'changed'; task: Task }
  | { type: 'types_changed'; boardId: string }
  | { type: 'boards_changed' }
  | { type: 'open'; boardId: string; taskId: string }
  | { type: 'open_today'; boardId: string }
  | { type: 'quick_record'; boardId: string };
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

/** Stable, renderer-safe startup failure categories. Raw storage errors stay in diagnostics. */
export type StartupFailureCode =
  | 'storage_unavailable'
  | 'database_corrupt'
  | 'schema_too_new'
  | 'snapshot_failed'
  | 'migration_failed'
  | 'verification_failed'
  | 'initialization_failed'
  | 'interrupted_migration';
export type StartupPhase = 'preflight' | 'checking' | 'snapshotting' | 'migrating' | 'verifying' | 'initializing';
export type StartupFailure = {
  code: StartupFailureCode;
  phase: StartupPhase;
  retryable: boolean;
  currentSchemaVersion: number;
  targetSchemaVersion: number;
  diagnosticId: string;
  message: string;
};
export type RecoveryStatus = {
  state: 'recovery_required';
  failure: StartupFailure;
  currentSchemaVersion: number;
  targetSchemaVersion: number;
  attemptId: string | null;
};
export type RecoverySnapshot = {
  id: string;
  createdAt: string;
  schemaVersion: number;
  appVersion: string;
  sizeBytes: number;
  sha256: string;
  state: 'available' | 'restored' | 'invalid';
};
export type RecoveryOperationCode = 'not_available' | 'invalid_selection' | 'restore_failed' | 'export_failed' | 'directory_unavailable' | 'quit_failed';
export const RECOVERY_CHANNELS = {
  getStatus: 'recovery:get-status',
  retry: 'recovery:retry',
  listSnapshots: 'recovery:list-snapshots',
  restoreSnapshot: 'recovery:restore-snapshot',
  exportDiagnostics: 'recovery:export-diagnostics',
  openDataDirectory: 'recovery:open-data-directory',
  openLogDirectory: 'recovery:open-log-directory',
  quit: 'recovery:quit',
} as const;
export type RecoveryOperationError = { code: RecoveryOperationCode; message: string };
export type RecoveryOperationResult = { ok: true } | { ok: false; error: RecoveryOperationError };
export type RecoveryRetryResult = { status: 'ready' } | { status: 'recovery_required'; recovery: RecoveryStatus };
export type RecoveryBridge = {
  getStatus: () => Promise<RecoveryStatus>;
  retry: () => Promise<RecoveryRetryResult>;
  listSnapshots: () => Promise<RecoverySnapshot[]>;
  restoreSnapshot: (snapshotId: string) => Promise<RecoveryOperationResult>;
  exportDiagnostics: () => Promise<RecoveryOperationResult>;
  openDataDirectory: () => Promise<RecoveryOperationResult>;
  openLogDirectory: () => Promise<RecoveryOperationResult>;
  quit: () => Promise<RecoveryOperationResult>;
};

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
    catalog: () => Promise<CodexPetCatalogEntry[]>;
    asset: (petId: string) => Promise<{ manifest: CodexPetManifest; dataUrl: string } | null>;
    import: () => Promise<CodexPetManifest | null>;
    delete: (petId: string) => Promise<void>;
    reveal: (petId: string) => Promise<void>;
    openFolder: () => Promise<void>;
    save: (config: DesktopPetConfig) => Promise<DesktopPetConfig>;
    focusMain: (target?: PetOpenTarget) => Promise<void>;
    takeOpenTarget: () => Promise<PetOpenTarget | null>;
    beginDrag: (screenX: number, screenY: number) => void;
    dragTo: (screenX: number, screenY: number) => void;
    endDrag: () => void;
    onState: (listener: (state: PetState) => void) => () => void;
    onFeedback: (listener: (feedback: PetFeedback) => void) => () => void;
    onOpenTarget: (listener: (target: PetOpenTarget) => void) => () => void;
    onConfig: (listener: (config: DesktopPetConfig) => void) => () => void;
    onOpenSettings: (listener: (section?: string) => void) => () => void;
  };
  reasoning: {
    get: (conversationId: string) => Promise<ReasoningSelection>;
    save: (conversationId: string, level: ReasoningSelection) => Promise<ReasoningSelection>;
  };
  permissions: {
    get: (conversationId: string) => Promise<ToolPermissionMode>;
    save: (conversationId: string, mode: ToolPermissionMode) => Promise<ToolPermissionMode>;
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
    create: (input?: CreateNoteInput | string, parentId?: string | null) => Promise<Note>;
    update: (id: string, patch: { title?: string; content?: string; archived?: boolean; icon?: string | null; cover?: string | null; favorite?: boolean; properties?: NoteProperties }) => Promise<Note>;
    touch: (id: string) => Promise<Note>;
    moveBlock: (sourceId: string, targetId: string, sourceContent: string, blockMarkdown: string) => Promise<{ source: Note; target: Note }>;
    move: (id: string, parentId: string | null, targetId?: string) => Promise<Note>;
    delete: (id: string) => Promise<void>;
    covers: { pick: () => Promise<NoteCover | null> };
    versions: {
      list: (noteId: string) => Promise<NoteVersion[]>;
      restore: (noteId: string, versionId: string) => Promise<Note>;
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
