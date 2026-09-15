import type { IpcMainInvokeEvent } from 'electron';
import { isToolPermissionMode, type ToolPermissionMode } from '../permission-mode';
import type { AppStore, ReasoningSelection } from '../store';
import { assertText } from './ipc-input';
import type { DomainIpcRegistrar } from './secured-ipc-registrar';

type RunSettingsStore = Pick<AppStore,
  'listRuns' | 'getConversation' | 'getReasoningSelection' | 'saveReasoningSelection' | 'getToolPermissionMode' | 'saveToolPermissionMode'
>;

export type RunIpcDependencies = {
  registrar: DomainIpcRegistrar;
  store: RunSettingsStore;
  getPermissionMode(conversationId: string): ToolPermissionMode;
  savePermissionMode(conversationId: string, mode: ToolPermissionMode): ToolPermissionMode;
  pickAttachments(event: IpcMainInvokeEvent): Promise<unknown>;
  addAttachments(paths: unknown): Promise<unknown>;
  releaseAttachments(attachmentIds: unknown): void;
  start(event: IpcMainInvokeEvent, conversationId: unknown, content: unknown, attachmentIds: unknown, reasoningLevel: unknown): unknown;
  retry(event: IpcMainInvokeEvent, conversationId: unknown, inputMessageId: unknown, content: unknown, reasoningLevel: unknown): unknown;
  cancel(runId: string): void;
  approve(senderId: number, approvalId: string, approved: boolean): void;
};

export function registerRunIpc(dependencies: RunIpcDependencies): void {
  const { registrar, store } = dependencies;
  registrar.main('runs:list', (_event, conversationId: unknown) => store.listRuns(assertText(conversationId, 'conversationId')));
  registrar.main('reasoning:get', (_event, conversationId: unknown): ReasoningSelection => {
    if (typeof conversationId !== 'string' || !conversationId.trim()) throw new Error('Conversation ID is required.');
    return store.getReasoningSelection(conversationId);
  });
  registrar.main('reasoning:save', (_event, conversationId: unknown, raw: unknown): ReasoningSelection => {
    if (typeof conversationId !== 'string' || !conversationId.trim()) throw new Error('Conversation ID is required.');
    if (raw !== 'default' && raw !== 'off' && raw !== 'low' && raw !== 'medium' && raw !== 'high' && raw !== 'xhigh' && raw !== 'max') throw new Error('Unsupported reasoning level.');
    return store.saveReasoningSelection(conversationId, raw);
  });
  registrar.main('permissions:get', (_event, conversationId: unknown): ToolPermissionMode => {
    const id = assertText(conversationId, 'conversationId'); store.getConversation(id); return dependencies.getPermissionMode(id);
  });
  registrar.main('permissions:save', (_event, conversationId: unknown, raw: unknown): ToolPermissionMode => {
    const id = assertText(conversationId, 'conversationId'); store.getConversation(id);
    if (!isToolPermissionMode(raw)) throw new Error('Unsupported tool permission mode.');
    return dependencies.savePermissionMode(id, raw);
  });
  registrar.main('attachments:pick', (event) => dependencies.pickAttachments(event));
  registrar.main('attachments:add-paths', (_event, paths: unknown) => dependencies.addAttachments(paths));
  registrar.main('attachments:release', (_event, attachmentIds: unknown) => dependencies.releaseAttachments(attachmentIds));
  registrar.main('runs:start', (event, conversationId: unknown, content: unknown, attachmentIds: unknown, reasoningLevel: unknown) => dependencies.start(event, conversationId, content, attachmentIds, reasoningLevel));
  registrar.main('runs:retry', (event, conversationId: unknown, inputMessageId: unknown, content: unknown, reasoningLevel: unknown) => dependencies.retry(event, conversationId, inputMessageId, content, reasoningLevel));
  registrar.main('runs:cancel', (_event, runId: unknown) => dependencies.cancel(assertText(runId, 'runId')));
  registrar.main('runs:approve', (event, approvalId: unknown, approved: unknown) => dependencies.approve(event.sender.id, assertText(approvalId, 'approvalId'), approved === true));
}
