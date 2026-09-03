import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_AGENT_PROFILE_ID, type AgentProfileId } from './agent-profiles';
import type { ConversationBackup } from './conversation-backup';
import type { PersistentToolPermissionMode } from './permission-mode';
import { createStorageRepositories, type StorageRepositories } from './storage/repositories';
import { DatabaseOwner } from './storage/database';
import { prepareStandaloneDatabase } from './storage/standalone-database';
import type { RecoveredRunWorkspace } from './storage/repositories/run-repository';
import type { UserSkillRegistration } from './skills';

export type ProviderConfig = {
  id: string;
  protocol: 'openai' | 'anthropic';
  baseUrl: string;
  model: string;
  displayName: string;
  contextWindow: number;
  supportsImages?: boolean;
  hasApiKey: boolean;
};
export type BrowserUseConfig = { enabled: boolean };
export type ComputerUseConfig = { enabled: boolean };
export type ConversationCapabilityOverride = 'default' | 'enabled' | 'disabled';
export type ConversationCapabilities = {
  browserUse: ConversationCapabilityOverride;
  computerUse: ConversationCapabilityOverride;
};
export type PetFeedbackMode = 'important' | 'all' | 'hidden';
export type DesktopPetConfig = {
  enabled: boolean;
  petId?: string;
  scale?: number;
  locked?: boolean;
  opacity?: number;
  alwaysOnTop?: boolean;
  edgeSnap?: boolean;
  inertia?: boolean;
  boundaryBounce?: boolean;
  feedbackMode?: PetFeedbackMode;
  completionFeedback?: boolean;
  errorFeedback?: boolean;
  approvalFeedback?: boolean;
  soundEnabled?: boolean;
  mutedUntil?: number;
};
export type ReasoningSelection = 'default' | 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const DEFAULT_CONVERSATION_PROJECT_ID = 'personal';
export const DEFAULT_PROVIDER_ID = 'default';
export const DEFAULT_PROVIDER_CONTEXT_WINDOW = 200_000;
export const MIN_PROVIDER_CONTEXT_WINDOW = 4_096;
export const MAX_PROVIDER_CONTEXT_WINDOW = 10_000_000;
export const CURRENT_SCHEMA_VERSION = 1;
export type ConversationProject = { id: string; name: string; position: number; workspacePath?: string | null };
export type Conversation = { id: string; projectId: string; title: string; updatedAt: string; archived: boolean; pinned: boolean; providerId?: string; profileId: AgentProfileId; workspacePath?: string | null };
export type Message = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string };
export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type RunUsage = { inputTokens: number; outputTokens: number; totalTokens: number; contextTokens: number | null; contextWindow: number; contextPercent: number | null };
export type RunActivityStatus = 'running' | 'completed' | 'failed' | 'cancelled';
export type RunArtifact = { id: string; kind: 'browser_screenshot' | 'computer_screenshot'; mimeType: string; size: number; url: string };
export type RunActivity = { id: string; toolName: string; status: RunActivityStatus; input: string | null; output: string | null; startedAt: string; finishedAt: string | null; artifacts: RunArtifact[] };
export type RunSummary = { id: string; conversationId: string; status: RunStatus; error: string | null; startedAt: string; finishedAt: string | null; inputMessageId: string | null; usage: RunUsage | null; activities: RunActivity[] };
export const DEFAULT_TASK_BOARD_ID = 'default';
export type TaskBoard = { id: string; name: string; position: number };
export type TaskStatus = string;
export type TaskType = { id: string; boardId: string; name: string; position: number };
export type TaskPriority = 'low' | 'medium' | 'high';
export type Task = {
  id: string;
  boardId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
  remindAt: string | null;
  reminderFiredAt: string | null;
  sourceConversationId: string | null;
  createdAt: string;
  updatedAt: string;
};
export type Note = {
  id: string;
  knowledgeBaseId: string;
  parentId: string | null;
  title: string;
  content: string;
  icon: string | null;
  cover: string | null;
  position: number;
  archived: boolean;
  favorite: boolean;
  lastOpenedAt: string | null;
  createdAt: string;
  updatedAt: string;
  properties: NoteProperties;
};
export type KnowledgeBase = {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  position: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};
export type NoteProperties = { status: string | null; date: string | null; tags: string[] };
export type NoteVersion = { id: string; noteId: string; title: string; content: string; icon: string | null; cover: string | null; properties: NoteProperties; createdAt: string };
export type CreateNoteInput = { title?: string; parentId?: string | null; content?: string; icon?: string | null };
export type CreateKnowledgeBaseInput = { name?: string; icon?: string | null; color?: string | null };
export type UpdateKnowledgeBaseInput = Partial<Pick<KnowledgeBase, 'name' | 'icon' | 'color' | 'archived'>>;
export type UpdateNoteInput = Partial<Pick<Note, 'title' | 'content' | 'archived' | 'icon' | 'cover' | 'favorite' | 'properties'>>;
export type CreateTaskInput = Pick<Task, 'title'> & Partial<Pick<Task, 'description' | 'status' | 'priority' | 'dueAt' | 'remindAt' | 'sourceConversationId'>>;
export type UpdateTaskInput = Partial<Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'dueAt' | 'remindAt'>>;
export type SearchResultKind = 'conversation' | 'message' | 'task' | 'board' | 'note';
export type SearchResult = {
  kind: SearchResultKind;
  id: string;
  parentId: string | null;
  title: string;
  snippet: string;
  context: string;
  updatedAt: string;
  archived: boolean;
  knowledgeBaseId?: string;
};

export type FullBackupSnapshot = {
  conversationProjects: Array<{ id: string; name: string; position: number; workspacePath?: string | null; createdAt: string; updatedAt: string }>;
  conversations: Array<{ id: string; projectId: string; title: string; description: string; archived: boolean; pinned: boolean; reasoningLevel: string; providerId: string | null; profileId: string; workspacePath?: string | null; createdAt: string; updatedAt: string }>;
  messages: Array<{ id: string; conversationId: string; role: Message['role']; content: string; createdAt: string }>;
  runs: Array<{ id: string; conversationId: string; inputMessageId: string | null; status: RunStatus; error: string | null; startedAt: string; finishedAt: string | null; inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; contextTokens: number | null; contextWindow: number | null; contextPercent: number | null }>;
  runActivities: Array<{ id: string; runId: string; toolCallId: string; toolName: string; status: RunActivityStatus; input: string | null; output: string | null; startedAt: string; finishedAt: string | null }>;
  runArtifacts: Array<{ id: string; runId: string; toolCallId: string; kind: RunArtifact['kind']; mimeType: string; size: number; url: string; createdAt: string }>;
  providers: Array<{ id: string; protocol: ProviderConfig['protocol']; baseUrl: string; model: string; displayName: string; contextWindow: number; supportsImages?: boolean; updatedAt: string }>;
  appSettings: Array<{ key: string; value: string; updatedAt: string }>;
  taskBoards: Array<{ id: string; name: string; position: number }>;
  taskTypes: Array<{ id: string; boardId: string; name: string; position: number }>;
  tasks: Array<{ id: string; boardId: string; title: string; description: string; position: number; status: string; priority: TaskPriority; dueAt: string | null; remindAt: string | null; reminderFiredAt: string | null; sourceConversationId: string | null; createdAt: string; updatedAt: string }>;
  knowledgeBases?: Array<{ id: string; name: string; icon?: string | null; color?: string | null; position: number; archived: boolean; createdAt: string; updatedAt: string }>;
  notes?: Array<{ id: string; knowledgeBaseId?: string | null; parentId: string | null; title: string; content: string; icon?: string | null; cover?: string | null; properties?: NoteProperties; position: number; archived: boolean; favorite?: boolean; lastOpenedAt?: string | null; createdAt: string; updatedAt: string }>;
  noteVersions?: Array<{ id: string; noteId: string; title: string; content: string; icon?: string | null; cover?: string | null; properties?: NoteProperties; createdAt: string }>;
};
export type BackupConfig = { enabled: boolean; directory: string; retention: number; lastRunAt: string | null; lastError: string | null };
export type DesktopPresenceConfig = { notificationsEnabled: boolean; menuBarEnabled: boolean };

export class AppStore {
  private readonly owner: DatabaseOwner;
  private readonly repositories: StorageRepositories;
  private readonly ownsDatabase: boolean;

  static fromPreparedDatabase(owner: DatabaseOwner): AppStore {
    const store = new AppStore('', owner);
    store.repositories.conversations.seedDemoData();
    store.repositories.search.initialize();
    return store;
  }

  constructor(dataDir: string, preparedOwner?: DatabaseOwner) {
    if (preparedOwner) {
      this.owner = preparedOwner;
      this.ownsDatabase = false;
      this.repositories = createStorageRepositories(this.owner);
      return;
    }

    fs.mkdirSync(dataDir, { recursive: true });
    this.owner = DatabaseOwner.open(path.join(dataDir, 'yuheng.sqlite'));
    this.ownsDatabase = true;
    this.repositories = createStorageRepositories(this.owner);
    prepareStandaloneDatabase(this.owner);
    this.repositories.conversations.seedDemoData();
    this.repositories.search.initialize();
  }

  search(rawQuery: string, requestedLimit = 30): SearchResult[] {
    return this.repositories.search.search(rawQuery, requestedLimit);
  }

  listConversationProjects(): ConversationProject[] {
    return this.repositories.conversations.listProjects();
  }

  createConversationProject(name: string, workspacePath?: string | null): ConversationProject {
    return this.repositories.conversations.createProject(name, workspacePath);
  }

  getConversationProjectWorkspace(id: string): string | null {
    return this.repositories.conversations.projectWorkspace(id);
  }

  getConversationWorkspaceOverride(id: string): string | null {
    return this.repositories.conversations.workspaceOverride(id);
  }

  getConversationWorkspace(id: string): string | null {
    const conversation = this.repositories.conversations.require(id);
    const projectWorkspace = this.repositories.conversations.projectWorkspace(conversation.projectId);
    return conversation.workspacePath?.trim() || projectWorkspace?.trim() || null;
  }

  setConversationWorkspace(id: string, workspacePath: string | null): Conversation {
    return this.repositories.conversations.setWorkspace(id, workspacePath);
  }

  setConversationProjectWorkspace(id: string, workspacePath: string | null): ConversationProject {
    return this.repositories.conversations.setProjectWorkspace(id, workspacePath);
  }

  renameConversationProject(id: string, name: string): ConversationProject {
    return this.repositories.conversations.renameProject(id, name);
  }

  deleteConversationProject(id: string): void {
    this.repositories.conversations.deleteProject(id, DEFAULT_CONVERSATION_PROJECT_ID);
  }

  listConversations(includeArchived = false): Conversation[] {
    return this.repositories.conversations.list(includeArchived);
  }

  getConversation(id: string): Conversation {
    return this.repositories.conversations.require(id);
  }

  listMessages(conversationId: string): Message[] {
    return this.repositories.conversations.listMessages(conversationId);
  }

  exportConversation(id: string): ConversationBackup {
    return this.repositories.conversations.exportConversation(id);
  }

  importConversation(backup: ConversationBackup): Conversation {
    return this.repositories.conversations.importConversation(backup);
  }

  createConversation(title = '新会话', projectId = DEFAULT_CONVERSATION_PROJECT_ID, providerId?: string, profileId: AgentProfileId = DEFAULT_AGENT_PROFILE_ID): Conversation {
    return this.repositories.conversations.create(title, projectId, providerId, profileId);
  }

  branchConversation(conversationId: string, messageId: string): Conversation {
    return this.repositories.conversations.branch(conversationId, messageId);
  }

  getConversationProviderId(conversationId: string): string | null {
    return this.repositories.conversations.providerId(conversationId);
  }

  setConversationProvider(conversationId: string, providerId: string): string {
    return this.repositories.conversations.setProvider(conversationId, providerId);
  }

  getConversationProfile(conversationId: string): AgentProfileId {
    return this.repositories.conversations.profileId(conversationId);
  }

  setConversationProfile(conversationId: string, profileId: AgentProfileId): AgentProfileId {
    return this.repositories.conversations.setProfile(conversationId, profileId);
  }

  moveConversation(id: string, projectId: string): Conversation {
    return this.repositories.conversations.move(id, projectId);
  }

  renameConversation(id: string, title: string): Conversation {
    return this.repositories.conversations.rename(id, title);
  }

  setConversationArchived(id: string, archived: boolean): Conversation {
    return this.repositories.conversations.setArchived(id, archived);
  }

  setConversationPinned(id: string, pinned: boolean): Conversation {
    return this.repositories.conversations.setPinned(id, pinned);
  }

  deleteConversation(id: string): void {
    this.repositories.conversations.delete(id);
  }

  addMessage(conversationId: string, role: Message['role'], content: string, id = crypto.randomUUID()): Message {
    return this.repositories.conversations.addMessage(conversationId, role, content, id);
  }

  updateMessage(id: string, content: string): void {
    this.repositories.conversations.updateMessage(id, content);
  }

  deleteMessage(id: string): void {
    this.repositories.conversations.deleteMessage(id);
  }

  replaceFromUserMessage(conversationId: string, messageId: string, content: string): Message {
    return this.repositories.conversations.replaceFromUserMessage(conversationId, messageId, content);
  }

  startRun(id: string, conversationId: string, inputMessageId: string): void {
    this.repositories.runs.start(id, conversationId, inputMessageId);
  }

  finishRun(id: string, status: Exclude<RunStatus, 'running'>, error?: string, usage?: RunUsage): boolean {
    return this.repositories.runs.finish(id, status, error, usage);
  }

  recoverRunningRuns(): number {
    return this.repositories.runs.recoverRunning();
  }

  recoverRunningRunWorkspaces(): RecoveredRunWorkspace[] {
    return this.repositories.runs.recoverRunningWorkspaces();
  }

  startToolActivity(runId: string, toolCallId: string, toolName: string, input?: string): void {
    this.repositories.runs.startActivity(runId, toolCallId, toolName, input);
  }

  finishToolActivity(runId: string, toolCallId: string, toolName: string, isError: boolean, output?: string): void {
    this.repositories.runs.finishActivity(runId, toolCallId, toolName, isError, output);
  }

  addRunArtifact(runId: string, toolCallId: string, artifact: RunArtifact): void {
    this.repositories.runs.addArtifact(runId, toolCallId, artifact);
  }

  deleteRunArtifactsBefore(cutoff: string): RunArtifact[] {
    return this.repositories.runs.deleteArtifactsBefore(cutoff);
  }

  listRunActivities(runId: string): RunActivity[] {
    return this.repositories.runs.listActivities(runId);
  }

  listRuns(conversationId: string): RunSummary[] {
    return this.repositories.runs.list(conversationId);
  }

  listNotes(includeArchived = false): Note[] {
    return this.repositories.notes.list(includeArchived);
  }

  listKnowledgeBases(includeArchived = false): KnowledgeBase[] {
    return this.repositories.knowledgeBases.list(includeArchived);
  }

  getKnowledgeBase(id: string): KnowledgeBase | null {
    return this.repositories.knowledgeBases.get(id);
  }

  getDefaultKnowledgeBase(): KnowledgeBase {
    return this.repositories.knowledgeBases.getDefault();
  }

  getActiveKnowledgeBaseId(): string | null {
    const configured = this.repositories.knowledgeBases.getActiveId();
    if (configured && this.repositories.knowledgeBases.get(configured)?.archived === false) return configured;
    return this.repositories.knowledgeBases.list()[0]?.id ?? null;
  }

  setActiveKnowledgeBaseId(id: string): string {
    return this.repositories.knowledgeBases.setActiveId(id);
  }

  createKnowledgeBase(input: CreateKnowledgeBaseInput = {}): KnowledgeBase {
    return this.repositories.knowledgeBases.create(input);
  }

  updateKnowledgeBase(id: string, patch: UpdateKnowledgeBaseInput): KnowledgeBase {
    return this.repositories.knowledgeBases.update(id, patch);
  }

  deleteKnowledgeBase(id: string): void {
    this.repositories.knowledgeBases.delete(id);
  }

  reorderKnowledgeBases(id: string, targetId: string): KnowledgeBase[] {
    return this.repositories.knowledgeBases.reorder(id, targetId);
  }

  listNotesInKnowledgeBase(knowledgeBaseId: string, includeArchived = false): Note[] {
    return this.repositories.notes.listInKnowledgeBase(knowledgeBaseId, includeArchived);
  }

  createNoteInKnowledgeBase(knowledgeBaseId: string, input?: CreateNoteInput | string, parentId?: string | null): Note {
    return this.repositories.notes.createInKnowledgeBase(knowledgeBaseId, input, parentId);
  }

  moveNoteToKnowledgeBase(id: string, knowledgeBaseId: string, parentId: string | null = null, targetId?: string): Note {
    return this.repositories.notes.moveToKnowledgeBase(id, knowledgeBaseId, parentId, targetId);
  }

  copyNoteToKnowledgeBase(id: string, knowledgeBaseId: string, parentId: string | null = null): Note {
    return this.repositories.notes.copyToKnowledgeBase(id, knowledgeBaseId, parentId);
  }

  getNote(id: string): Note | null {
    return this.repositories.notes.get(id);
  }

  createNote(input?: CreateNoteInput | string, parentId?: string | null): Note {
    return this.repositories.notes.create(input, parentId);
  }

  updateNote(id: string, patch: UpdateNoteInput): Note {
    return this.repositories.notes.update(id, patch);
  }

  listNoteVersions(noteId: string): NoteVersion[] {
    return this.repositories.notes.listVersions(noteId);
  }

  restoreNoteVersion(noteId: string, versionId: string): Note {
    return this.repositories.notes.restoreVersion(noteId, versionId);
  }

  touchNote(id: string): Note {
    return this.repositories.notes.touch(id);
  }

  moveNoteBlock(sourceId: string, targetId: string, sourceContent: string, blockMarkdown: string): { source: Note; target: Note } {
    return this.repositories.notes.moveBlock(sourceId, targetId, sourceContent, blockMarkdown);
  }

  moveNote(id: string, parentId: string | null = null, targetId?: string): Note {
    return this.repositories.notes.move(id, parentId, targetId);
  }

  deleteNote(id: string): void {
    this.repositories.notes.delete(id);
  }

  listTaskBoards(): TaskBoard[] {
    return this.repositories.tasks.listBoards();
  }

  createTaskBoard(name: string): TaskBoard {
    return this.repositories.tasks.createBoard(name);
  }

  renameTaskBoard(id: string, name: string): TaskBoard {
    return this.repositories.tasks.renameBoard(id, name);
  }

  reorderTaskBoards(id: string, targetId: string): TaskBoard[] {
    return this.repositories.tasks.reorderBoards(id, targetId);
  }

  deleteTaskBoard(id: string, replacementBoardId?: string): void {
    this.repositories.tasks.deleteBoard(id, replacementBoardId);
  }

  getDefaultTaskBoardId(): string {
    return this.repositories.tasks.getDefaultBoardId();
  }

  listTasks(boardId?: string): Task[] {
    return this.repositories.tasks.list(boardId);
  }

  listTaskTypes(boardId?: string): TaskType[] {
    return this.repositories.tasks.listTypes(boardId);
  }

  createTaskType(name: string, boardId?: string): TaskType {
    return this.repositories.tasks.createType(name, boardId);
  }

  renameTaskType(id: string, name: string): TaskType {
    return this.repositories.tasks.renameType(id, name);
  }

  deleteTaskType(id: string): TaskType {
    return this.repositories.tasks.deleteType(id);
  }

  createTask(input: CreateTaskInput, boardId?: string): Task {
    return this.repositories.tasks.create(input, boardId);
  }

  updateTask(id: string, patch: UpdateTaskInput): Task {
    return this.repositories.tasks.update(id, patch);
  }

  reorderTask(id: string, targetId: string): Task[] {
    return this.repositories.tasks.reorder(id, targetId);
  }

  moveTaskToBoard(id: string, boardId: string): Task {
    return this.repositories.tasks.moveToBoard(id, boardId);
  }

  copyTaskToBoard(id: string, boardId: string): Task {
    return this.repositories.tasks.copyToBoard(id, boardId);
  }

  deleteTask(id: string): void {
    this.repositories.tasks.delete(id);
  }

  getTask(id: string): Task {
    return this.repositories.tasks.get(id);
  }

  listPendingTaskReminders(): Task[] {
    return this.repositories.tasks.listPendingReminders();
  }

  markTaskReminderFired(id: string, expectedRemindAt: string, firedAt = new Date().toISOString()): Task | null {
    return this.repositories.tasks.markReminderFired(id, expectedRemindAt, firedAt);
  }

  listProviders(): ProviderConfig[] {
    return this.repositories.providers.list();
  }

  deleteProvider(id: string): void {
    this.repositories.providers.delete(id);
  }

  defaultProviderId(): string | null {
    return this.repositories.providers.defaultId();
  }

  setDefaultProviderId(id: string): string {
    return this.repositories.providers.setDefaultId(id);
  }

  getProvider(id?: string): ProviderConfig | null {
    return this.repositories.providers.get(id);
  }

  saveProvider(config: Omit<ProviderConfig, 'hasApiKey' | 'id'> & { id?: string }): ProviderConfig {
    return this.repositories.providers.save(config);
  }

  getBrowserUseConfig(): BrowserUseConfig {
    return this.repositories.settings.getBrowserUse();
  }

  saveBrowserUseConfig(config: BrowserUseConfig): BrowserUseConfig {
    return this.repositories.settings.saveBrowserUse(config);
  }

  getComputerUseConfig(): ComputerUseConfig {
    return this.repositories.settings.getComputerUse();
  }

  getDesktopPetConfig(): DesktopPetConfig {
    return this.repositories.settings.getDesktopPet();
  }

  saveDesktopPetConfig(config: DesktopPetConfig): DesktopPetConfig {
    return this.repositories.settings.saveDesktopPet(config);
  }

  saveComputerUseConfig(config: ComputerUseConfig): ComputerUseConfig {
    return this.repositories.settings.saveComputerUse(config);
  }

  getSkillRegistrations(): UserSkillRegistration[] {
    return this.repositories.settings.getSkillRegistrations();
  }

  saveSkillRegistrations(registrations: UserSkillRegistration[]): UserSkillRegistration[] {
    return this.repositories.settings.saveSkillRegistrations(registrations);
  }

  getConversationSkills(conversationId: string): string[] {
    return this.repositories.settings.getConversationSkills(conversationId);
  }

  saveConversationSkills(conversationId: string, skillIds: string[]): string[] {
    return this.repositories.settings.saveConversationSkills(conversationId, skillIds);
  }

  getConversationCapabilities(conversationId: string): ConversationCapabilities {
    return this.repositories.settings.getConversationCapabilities(conversationId);
  }

  saveConversationCapabilities(conversationId: string, capabilities: ConversationCapabilities): ConversationCapabilities {
    return this.repositories.settings.saveConversationCapabilities(conversationId, capabilities);
  }

  getEffectiveConversationCapabilities(conversationId: string): { browserUse: boolean; computerUse: boolean } {
    const overrides = this.getConversationCapabilities(conversationId);
    const browserDefault = this.getBrowserUseConfig().enabled;
    const computerDefault = this.getComputerUseConfig().enabled;
    return {
      browserUse: overrides.browserUse === 'default' ? browserDefault : overrides.browserUse === 'enabled',
      computerUse: overrides.computerUse === 'default' ? computerDefault : overrides.computerUse === 'enabled',
    };
  }

  getReasoningSelection(conversationId: string): ReasoningSelection {
    return this.repositories.settings.getReasoning(conversationId);
  }

  saveReasoningSelection(conversationId: string, selection: ReasoningSelection): ReasoningSelection {
    return this.repositories.settings.saveReasoning(conversationId, selection);
  }

  getToolPermissionMode(conversationId: string): PersistentToolPermissionMode {
    return this.repositories.settings.getToolPermission(conversationId);
  }

  saveToolPermissionMode(conversationId: string, mode: PersistentToolPermissionMode): PersistentToolPermissionMode {
    return this.repositories.settings.saveToolPermission(conversationId, mode);
  }

  getBackupConfig(defaultDirectory: string): BackupConfig {
    return this.repositories.settings.getBackup(defaultDirectory);
  }

  saveBackupConfig(config: Pick<BackupConfig, 'enabled' | 'directory' | 'retention'> & Partial<Pick<BackupConfig, 'lastRunAt' | 'lastError'>>): BackupConfig {
    return this.repositories.settings.saveBackup(config);
  }

  getDesktopPresenceConfig(): DesktopPresenceConfig {
    return this.repositories.settings.getDesktopPresence();
  }

  saveDesktopPresenceConfig(config: Partial<DesktopPresenceConfig>): DesktopPresenceConfig {
    return this.repositories.settings.saveDesktopPresence(config);
  }

  exportFullBackupSnapshot(): FullBackupSnapshot {
    return this.repositories.backups.export();
  }

  importFullBackupSnapshot(snapshot: FullBackupSnapshot): { conversations: number; messages: number; tasks: number; notes: number; missingProviders: number; conversationMap: Record<string, string> } {
    return this.repositories.backups.import(snapshot);
  }

  close(): void {
    if (this.ownsDatabase) this.owner.close();
  }
}
