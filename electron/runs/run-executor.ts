import type { WebContents } from 'electron';
import path from 'node:path';
import { getAgentProfile, loadAgentProfilePrompt, formatRuntimeContext } from '../agent-profiles';
import { BrowserArtifactStore, browserImagesFromToolResult, type BrowserArtifact } from '../browser-artifacts';
import { BrowserUseSupervisor } from '../browser-use';
import { ComputerUseLease } from '../computer-use';
import { createPiRuntime, createPiSessionFactory, type ReasoningLevel } from '../pi-runtime';
import { FileSecurityAuditLog } from '../security-audit';
import { ToolSecurityBroker, ToolSecurityPolicy, redactToolApprovalInput } from '../security-policy';
import type { AppStore, ProviderConfig, RunUsage, Task } from '../store';
import { loadYuhengSystemPrompt } from '../system-prompt';
import { ApprovalCoordinator } from './approval-coordinator';
import { ProjectRunWorkspace, type PreparedRunWorkspace } from './project-run-workspace';
import { RunCoordinator } from './run-coordinator';

export type StoredAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  sourcePath: string;
};

export type RunEvent =
  | { type: 'accepted'; runId: string; conversationId: string }
  | { type: 'delta'; runId: string; conversationId: string; messageId: string; delta: string; createdAt: string }
  | { type: 'tool_start'; runId: string; conversationId: string; toolCallId: string; toolName: string; input?: string }
  | { type: 'tool_end'; runId: string; conversationId: string; toolCallId: string; toolName: string; isError: boolean; output?: string; artifacts: BrowserArtifact[] }
  | { type: 'approval_required'; runId: string; conversationId: string; approvalId: string; toolCallId: string; toolName: string; input?: string }
  | { type: 'approval_resolved'; runId: string; conversationId: string; approvalId: string; approved: boolean }
  | { type: 'completed'; runId: string; conversationId: string; messageId: string }
  | { type: 'failed'; runId: string; conversationId: string; error: string }
  | { type: 'cancelled'; runId: string; conversationId: string };

export type RunExecutorOptions = {
  store: AppStore;
  browserUse: BrowserUseSupervisor;
  browserArtifacts: BrowserArtifactStore;
  securityAudit: FileSecurityAuditLog;
  runCoordinator: RunCoordinator;
  approvalCoordinator: ApprovalCoordinator;
  userDataDirectory: string;
  projectRunWorkspace?: ProjectRunWorkspace;
  applicationPath: string;
  emit(sender: WebContents, event: RunEvent): void;
  taskChanged(task: Task): void;
  removeAttachment(attachmentId: string): void;
};

export class RunExecutor {
  private readonly computerUseLease = new ComputerUseLease();

  constructor(private readonly options: RunExecutorOptions) {}

  async execute(
    sender: WebContents,
    runId: string,
    conversationId: string,
    config: ProviderConfig,
    apiKey: string,
    runAttachments: StoredAttachment[],
    reasoningLevel?: ReasoningLevel,
  ): Promise<void> {
    const { store, runCoordinator } = this.options;
    const run = runCoordinator.get(runId);
    if (!run) return;
    const assistantMessageId = crypto.randomUUID();
    let assistantCreated = false;
    let assistantCreatedAt: string | null = null;
    let assistantContent = '';
    let runUsage: RunUsage | undefined;
    const capabilities = store.getEffectiveConversationCapabilities(conversationId);
    const profileId = store.getConversationProfile(conversationId);
    const profile = getAgentProfile(profileId);
    let releaseComputerUse: (() => void) | undefined;
    let runtime: ReturnType<typeof createPiRuntime> | undefined;
    let preparedWorkspace: PreparedRunWorkspace | undefined;
    try {
      const project = store.getConversation(conversationId);
      const workspaceManager = this.options.projectRunWorkspace
        ?? new ProjectRunWorkspace(path.join(this.options.userDataDirectory, 'workspace'));
      preparedWorkspace = await workspaceManager.prepare(project.projectId, runId, runAttachments, store.getConversationWorkspace(conversationId));
      const toolSecurity = new ToolSecurityBroker({
        policy: new ToolSecurityPolicy(preparedWorkspace.projectDirectory, run.permissionMode),
        audit: this.options.securityAudit,
        requestApproval: ({ toolCallId, toolName, input, signal }) => this.requestApproval(
          sender,
          runId,
          conversationId,
          toolCallId,
          toolName,
          input,
          signal,
        ),
      });
      if (capabilities.computerUse) releaseComputerUse = await this.computerUseLease.acquire(run.controller.signal);
      runtime = createPiRuntime({
        sessionFactory: createPiSessionFactory(config, apiKey, {
          agentDir: path.join(this.options.userDataDirectory, 'pi-agent'),
          applicationPath: this.options.applicationPath,
          yuhengSystemPrompt: loadYuhengSystemPrompt(this.options.applicationPath),
          profilePrompt: loadAgentProfilePrompt(this.options.applicationPath, profileId),
          runtimeContext: profile.timeContext === 'full' ? formatRuntimeContext() : undefined,
          thinkingLevel: reasoningLevel,
          skillRegistrations: store.getSkillRegistrations(),
          selectedSkillIds: store.getConversationSkills(conversationId),
          taskService: {
            listBoards: () => store.listTaskBoards(),
            listTypes: (boardId) => store.listTaskTypes(boardId),
            listTasks: (boardId) => store.listTasks(boardId),
            createTask: (boardId, input) => store.createTask(input, boardId),
            updateTask: (taskId, update) => store.updateTask(taskId, update),
            taskChanged: this.options.taskChanged,
          },
          browserUse: capabilities.browserUse ? { supervisor: this.options.browserUse } : undefined,
          computerUse: capabilities.computerUse ? {} : undefined,
          security: {
            authorize: ({ toolCallId, toolName, input, signal }) => toolSecurity.authorize({
              runId,
              conversationId,
              toolCallId,
              toolName,
              input,
              signal,
            }),
          },
        }),
      });
      const messages = store.listMessages(conversationId);
      const inputIndex = messages.findIndex((message) => message.id === run.inputMessageId);
      if (inputIndex < 0 || messages[inputIndex].role !== 'user') throw new Error('运行输入消息已不存在。');
      const prompt = messages[inputIndex].content;
      await runtime.start({
        prompt: `${prompt || '请查看附件并回复。'}${preparedWorkspace.promptContext}`,
        images: [],
        sessionId: conversationId,
        cwd: preparedWorkspace.projectDirectory,
        history: messages.slice(0, inputIndex).map(({ role, content, createdAt }) => ({ role, content, createdAt })),
        replayUser: run.replayUser,
        signal: run.controller.signal,
        emit: (event) => {
          if (event.type === 'tool_start') {
            const redactedArgs = event.args && typeof event.args === 'object' && !Array.isArray(event.args)
              ? redactToolApprovalInput(event.toolName, event.args as Record<string, unknown>)
              : event.args;
            const input = this.summarize(redactedArgs);
            store.startToolActivity(runId, event.toolCallId, event.toolName, input);
            this.options.emit(sender, { type: 'tool_start', runId, conversationId, toolCallId: event.toolCallId, toolName: event.toolName, input });
            return;
          }
          if (event.type === 'tool_end') {
            const output = this.summarize(event.result);
            const artifactKind = event.toolName.startsWith('browser_') ? 'browser_screenshot' : 'computer_screenshot';
            const artifacts = browserImagesFromToolResult(event.result).map(({ data, mimeType }) => {
              const artifact = this.options.browserArtifacts.saveImage(data, mimeType, artifactKind);
              store.addRunArtifact(runId, event.toolCallId, artifact);
              return artifact;
            });
            store.finishToolActivity(runId, event.toolCallId, event.toolName, event.isError, output);
            this.options.emit(sender, { type: 'tool_end', runId, conversationId, toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError, output, artifacts });
            return;
          }
          if (event.type === 'completed') { runUsage = event.usage; return; }
          if (event.type !== 'text_delta') return;
          const delta = event.delta;
          if (!assistantCreated) {
            assistantCreatedAt = store.addMessage(conversationId, 'assistant', '', assistantMessageId).createdAt;
            assistantCreated = true;
          }
          assistantContent += delta;
          store.updateMessage(assistantMessageId, assistantContent);
          this.options.emit(sender, { type: 'delta', runId, conversationId, messageId: assistantMessageId, delta, createdAt: assistantCreatedAt! });
        },
      });
      if (run.controller.signal.aborted) {
        if (!assistantCreated) store.addMessage(conversationId, 'assistant', '', assistantMessageId);
        store.finishRun(runId, 'cancelled');
        this.options.emit(sender, { type: 'cancelled', runId, conversationId });
        return;
      }
      if (!assistantCreated) store.addMessage(conversationId, 'assistant', '', assistantMessageId);
      store.finishRun(runId, 'completed', undefined, runUsage);
      this.options.emit(sender, { type: 'completed', runId, conversationId, messageId: assistantMessageId });
    } catch (error) {
      const cancelled = run.controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
      if (!assistantCreated && cancelled) {
        store.finishRun(runId, 'cancelled');
        this.options.emit(sender, { type: 'cancelled', runId, conversationId });
      } else {
        const rawMessage = error instanceof Error ? error.message : 'Provider request failed.';
        const message = (apiKey ? rawMessage.replaceAll(apiKey, '[redacted]') : rawMessage).slice(0, 2_000);
        store.finishRun(runId, cancelled ? 'cancelled' : 'failed', message);
        if (cancelled) this.options.emit(sender, { type: 'cancelled', runId, conversationId });
        else this.options.emit(sender, { type: 'failed', runId, conversationId, error: message });
      }
    } finally {
      try {
        await runtime?.dispose();
      } finally {
        releaseComputerUse?.();
        for (const attachment of runAttachments) this.options.removeAttachment(attachment.id);
        await preparedWorkspace?.cleanup().catch(() => undefined);
        this.options.approvalCoordinator.rejectRun(runId);
        runCoordinator.finish(runId);
      }
    }
  }

  private requestApproval(
    sender: WebContents,
    runId: string,
    conversationId: string,
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (signal?.aborted || sender.isDestroyed()) return Promise.resolve(false);
    return this.options.approvalCoordinator.request({
      runId,
      senderId: sender.id,
      signal,
      onRequired: (approvalId) => this.options.emit(sender, {
        type: 'approval_required', runId, conversationId, approvalId, toolCallId, toolName,
        input: this.summarize(redactToolApprovalInput(toolName, args)),
      }),
      onResolved: (approvalId, approved) => this.options.emit(sender, { type: 'approval_resolved', runId, conversationId, approvalId, approved }),
    });
  }

  private summarize(value: unknown, maxLength = 400): string | undefined {
    if (value == null) return undefined;
    const text = typeof value === 'string' ? value : (() => {
      try {
        return JSON.stringify(value, (key, item: unknown) => {
          if (key === 'data' && typeof item === 'string' && item.length > 160) return `<omitted:${item.length} characters>`;
          return item;
        });
      } catch { return String(value); }
    })();
    const trimmed = text.trim();
    return trimmed ? (trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed) : undefined;
  }
}
