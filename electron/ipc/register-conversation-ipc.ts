import { BrowserWindow, dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isAgentProfileId } from '../agent-profiles';
import { MAX_CONVERSATION_BACKUP_BYTES, conversationBackupMarkdown, parseConversationBackup } from '../conversation-backup';
import type { AppStore, ConversationProject } from '../store';
import { assertText } from './ipc-input';
import type { DomainIpcRegistrar } from './secured-ipc-registrar';

type ConversationStore = Pick<AppStore,
  | 'listConversations' | 'listConversationProjects' | 'createConversationProject' | 'renameConversationProject'
  | 'deleteConversationProject' | 'listMessages' | 'branchConversation' | 'createConversation'
  | 'setConversationProvider' | 'getConversation' | 'setConversationProfile' | 'renameConversation'
  | 'moveConversation' | 'setConversationArchived' | 'setConversationPinned' | 'deleteConversation'
  | 'exportConversation' | 'importConversation'
>;

export type ConversationIpcDependencies = {
  registrar: DomainIpcRegistrar;
  store: ConversationStore;
  isConversationActive(conversationId: string): boolean;
  onConversationDeleted(conversationId: string): void | Promise<void>;
};

export function registerConversationIpc({ registrar, store, isConversationActive, onConversationDeleted }: ConversationIpcDependencies): void {
  registrar.main('conversations:list', (_event, includeArchived: unknown) => store.listConversations(includeArchived === true));
  registrar.main('conversation-projects:list', () => store.listConversationProjects());
  registrar.main('conversation-projects:create', (_event, name: unknown): ConversationProject => store.createConversationProject(assertText(name, 'name')));
  registrar.main('conversation-projects:rename', (_event, projectId: unknown, name: unknown): ConversationProject => store.renameConversationProject(assertText(projectId, 'projectId'), assertText(name, 'name')));
  registrar.main('conversation-projects:delete', (_event, projectId: unknown) => store.deleteConversationProject(assertText(projectId, 'projectId')));
  registrar.main('conversations:messages', (_event, conversationId: unknown) => store.listMessages(assertText(conversationId, 'conversationId')));
  registrar.main('conversations:branch', (_event, conversationId: unknown, messageId: unknown) => store.branchConversation(assertText(conversationId, 'conversationId'), assertText(messageId, 'messageId')));
  registrar.main('conversations:create', (_event, title: unknown, projectId: unknown, providerId: unknown, profileId: unknown) => {
    const selectedProfile = profileId == null ? undefined : (isAgentProfileId(profileId) ? profileId : (() => { throw new Error('Profile not found.'); })());
    return store.createConversation(typeof title === 'string' && title.trim() ? title.trim() : undefined, typeof projectId === 'string' && projectId.trim() ? projectId.trim() : undefined, typeof providerId === 'string' && providerId.trim() ? providerId.trim() : undefined, selectedProfile);
  });
  registrar.main('conversations:set-provider', (_event, conversationId: unknown, providerId: unknown) => {
    const id = assertText(conversationId, 'conversationId');
    store.setConversationProvider(id, assertText(providerId, 'providerId'));
    return store.getConversation(id);
  });
  registrar.main('conversations:set-profile', (_event, conversationId: unknown, profileId: unknown) => {
    const id = assertText(conversationId, 'conversationId');
    if (!isAgentProfileId(profileId)) throw new Error('Profile not found.');
    store.setConversationProfile(id, profileId);
    return store.getConversation(id);
  });
  registrar.main('conversations:rename', (_event, conversationId: unknown, title: unknown) => store.renameConversation(assertText(conversationId, 'conversationId'), assertText(title, 'title')));
  registrar.main('conversations:move', (_event, conversationId: unknown, projectId: unknown) => store.moveConversation(assertText(conversationId, 'conversationId'), assertText(projectId, 'projectId')));
  registrar.main('conversations:archive', (_event, conversationId: unknown, archived: unknown) => store.setConversationArchived(assertText(conversationId, 'conversationId'), archived === true));
  registrar.main('conversations:pin', (_event, conversationId: unknown, pinned: unknown) => store.setConversationPinned(assertText(conversationId, 'conversationId'), pinned === true));
  registrar.main('conversations:delete', async (_event, conversationId: unknown) => {
    const id = assertText(conversationId, 'conversationId');
    if (isConversationActive(id)) throw new Error('该会话仍在处理中，请先停止运行。');
    store.deleteConversation(id);
    await onConversationDeleted(id);
  });
  registrar.main('conversations:export', async (event, conversationId: unknown) => {
    const backup = store.exportConversation(assertText(conversationId, 'conversationId'));
    const owner = BrowserWindow.fromWebContents(event.sender);
    const result = owner
      ? await dialog.showSaveDialog(owner, { defaultPath: `${backup.conversation.title || '会话'}.json`, filters: [{ name: '玉衡会话备份', extensions: ['json'] }, { name: 'Markdown', extensions: ['md'] }] })
      : await dialog.showSaveDialog({ defaultPath: `${backup.conversation.title || '会话'}.json`, filters: [{ name: '玉衡会话备份', extensions: ['json'] }, { name: 'Markdown', extensions: ['md'] }] });
    if (result.canceled || !result.filePath) return null;
    const content = result.filePath.toLowerCase().endsWith('.md') ? conversationBackupMarkdown(backup) : JSON.stringify(backup, null, 2);
    await fs.writeFile(result.filePath, content, 'utf8');
    return result.filePath;
  });
  registrar.main('conversations:import', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const result = owner
      ? await dialog.showOpenDialog(owner, { properties: ['openFile'], filters: [{ name: '玉衡会话备份', extensions: ['json'] }] })
      : await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: '玉衡会话备份', extensions: ['json'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    if ((await fs.stat(filePath)).size > MAX_CONVERSATION_BACKUP_BYTES) throw new Error('会话备份超过 5 MB。');
    return store.importConversation(parseConversationBackup(JSON.parse(await fs.readFile(filePath, 'utf8'))));
  });
}
