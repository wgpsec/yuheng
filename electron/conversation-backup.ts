import type { Conversation, Message } from './store';

export const CONVERSATION_BACKUP_VERSION = 1;
export const MAX_CONVERSATION_BACKUP_BYTES = 5 * 1024 * 1024;

export type ConversationBackup = {
  format: 'yuheng-conversation';
  version: 1;
  exportedAt: string;
  conversation: Pick<Conversation, 'title' | 'providerId' | 'profileId'>;
  messages: Array<Pick<Message, 'role' | 'content' | 'createdAt'>>;
};

export function toConversationBackup(conversation: Conversation, messages: Message[]): ConversationBackup {
  return {
    format: 'yuheng-conversation',
    version: CONVERSATION_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    conversation: { title: conversation.title, ...(conversation.providerId ? { providerId: conversation.providerId } : {}), profileId: conversation.profileId },
    messages: messages.map(({ role, content, createdAt }) => ({ role, content, createdAt })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

export function parseConversationBackup(raw: unknown): ConversationBackup {
  if (!isRecord(raw) || raw.format !== 'yuheng-conversation' || raw.version !== CONVERSATION_BACKUP_VERSION) throw new Error('不是受支持的玉衡会话备份。');
  const conversation = raw.conversation;
  if (!isRecord(conversation) || typeof conversation.title !== 'string' || !conversation.title.trim()) throw new Error('会话备份缺少有效标题。');
  if (!Array.isArray(raw.messages) || raw.messages.length > 50_000) throw new Error('会话备份消息数量无效。');
  const messages = raw.messages.map((item) => {
    if (!isRecord(item) || (item.role !== 'user' && item.role !== 'assistant') || typeof item.content !== 'string' || typeof item.createdAt !== 'string') throw new Error('会话备份包含无效消息。');
    return { role: item.role, content: item.content, createdAt: item.createdAt } as Pick<Message, 'role' | 'content' | 'createdAt'>;
  });
  const profileId = conversation.profileId;
  if (profileId !== 'assistant' && profileId !== 'analyst' && profileId !== 'auditor') throw new Error('会话备份包含无效 Profile。');
  const providerId = conversation.providerId;
  if (providerId !== undefined && (typeof providerId !== 'string' || !providerId.trim())) throw new Error('会话备份包含无效 Provider。');
  return { format: 'yuheng-conversation', version: 1, exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : new Date().toISOString(), conversation: { title: conversation.title.trim().slice(0, 200), profileId, ...(providerId ? { providerId } : {}) }, messages };
}

export function conversationBackupMarkdown(backup: ConversationBackup): string {
  const lines = [`# ${backup.conversation.title}`, '', `导出时间：${new Date(backup.exportedAt).toLocaleString('zh-CN')}`, ''];
  for (const message of backup.messages) lines.push(`## ${message.role === 'user' ? '你' : '玉衡'} · ${new Date(message.createdAt).toLocaleString('zh-CN')}`, '', message.content, '');
  return `${lines.join('\n').trim()}\n`;
}
