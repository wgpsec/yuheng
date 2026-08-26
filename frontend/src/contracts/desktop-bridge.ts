export type ProviderProtocol = 'openai' | 'anthropic';
export type ProviderConfig = { protocol: ProviderProtocol; baseUrl: string; model: string; displayName: string; hasApiKey: boolean };
export type Conversation = { id: string; title: string; updatedAt: string };
export type Message = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string };
export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type RunSummary = { id: string; conversationId: string; status: RunStatus; error: string | null; startedAt: string; finishedAt: string | null; inputMessageId: string | null };
export type Attachment = { id: string; name: string; mimeType: string; size: number };
export type RunEvent =
  | { type: 'accepted'; runId: string; conversationId: string }
  | { type: 'delta'; runId: string; conversationId: string; messageId: string; delta: string }
  | { type: 'completed'; runId: string; conversationId: string; messageId: string }
  | { type: 'failed'; runId: string; conversationId: string; error: string }
  | { type: 'cancelled'; runId: string; conversationId: string };

export type DesktopBridge = {
  conversations: {
    list: () => Promise<Conversation[]>;
    messages: (conversationId: string) => Promise<Message[]>;
    create: (title?: string) => Promise<Conversation>;
  };
  provider: {
    get: () => Promise<ProviderConfig | null>;
    save: (config: { protocol: ProviderProtocol; baseUrl: string; model: string; displayName: string; apiKey: string }) => Promise<ProviderConfig>;
  };
  attachments: {
    pick: () => Promise<Attachment[]>;
    release: (attachmentIds: string[]) => Promise<void>;
  };
  runs: {
    list: (conversationId: string) => Promise<RunSummary[]>;
    start: (conversationId: string, content: string, attachmentIds?: string[]) => Promise<{ runId: string; userMessage: Message }>;
    cancel: (runId: string) => Promise<void>;
    onEvent: (listener: (event: RunEvent) => void) => () => void;
  };
};
