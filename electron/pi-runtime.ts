import path from 'node:path';
import type { ProviderConfig } from './store';

export type PiImage = { type: 'image'; data: string; mimeType: string };

export type PiSessionEvent =
  | { type: 'message_update'; assistantMessageEvent: { type: 'text_delta'; delta: string } }
  | { type: 'agent_end'; willRetry?: boolean }
  | { type: 'tool_execution_start'; toolName: string }
  | { type: 'tool_execution_end'; toolName: string; isError: boolean };

export type PiRuntimeEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_start'; toolName: string }
  | { type: 'tool_end'; toolName: string; isError: boolean }
  | { type: 'completed' }
  | { type: 'failed'; error: string }
  | { type: 'cancelled' };

export type PiRuntimeInput = {
  prompt: string;
  images: PiImage[];
  sessionId: string;
  cwd: string;
  signal?: AbortSignal;
  emit: (event: PiRuntimeEvent) => void;
};

export type PiSession = {
  subscribe: (listener: (event: PiSessionEvent) => void) => () => void;
  prompt: (text: string, options?: { images?: PiImage[] }) => Promise<void>;
  abort: () => Promise<void>;
  dispose: () => void;
};

export type PiSessionFactory = (input: PiRuntimeInput) => Promise<PiSession>;

type PiSdk = typeof import('@earendil-works/pi-coding-agent');
type PiSessionFactoryOptions = { agentDir: string };

const loadPiSdk = (): Promise<PiSdk> => {
  // Keep the CommonJS Electron bundle compatible with Pi's ESM package.
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<PiSdk>;
  return dynamicImport('@earendil-works/pi-coding-agent');
};

function providerApi(protocol: ProviderConfig['protocol']): 'openai-completions' | 'anthropic-messages' {
  return protocol === 'anthropic' ? 'anthropic-messages' : 'openai-completions';
}

function providerBaseUrl(config: ProviderConfig): string {
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  return config.protocol === 'anthropic' ? baseUrl.replace(/\/v1$/, '') : baseUrl;
}

/** Builds a Pi session using only the explicitly configured provider and tools. */
export function createPiSessionFactory(config: ProviderConfig, apiKey: string, options: PiSessionFactoryOptions): PiSessionFactory {
  return async (input) => {
    const sdk = await loadPiSdk();
    const modelRuntime = await sdk.ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
    const providerId = `yuheng-${config.protocol}`;
    modelRuntime.registerProvider(providerId, {
      name: config.displayName,
      baseUrl: providerBaseUrl(config),
      api: providerApi(config.protocol),
      apiKey,
      models: [{
        id: config.model,
        name: config.displayName,
        api: providerApi(config.protocol),
        baseUrl: providerBaseUrl(config),
        reasoning: false,
        input: ['text', 'image'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 4096,
      }],
    });
    const model = modelRuntime.getModel(providerId, config.model);
    if (!model) throw new Error(`无法加载模型配置：${config.model}`);
    const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false } });
    const resourceLoader = new sdk.DefaultResourceLoader({
      cwd: input.cwd,
      agentDir: path.join(options.agentDir, 'resources'),
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await resourceLoader.reload();
    const { session } = await sdk.createAgentSession({
      cwd: input.cwd,
      model,
      modelRuntime,
      settingsManager,
      resourceLoader,
      sessionManager: sdk.SessionManager.inMemory(input.cwd, { id: input.sessionId }),
      tools: ['read', 'write', 'edit', 'bash'],
    });
    return {
      subscribe(listener) {
        return session.subscribe((event) => {
          if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') listener({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: event.assistantMessageEvent.delta } });
          else if (event.type === 'tool_execution_start') listener({ type: 'tool_execution_start', toolName: event.toolName });
          else if (event.type === 'tool_execution_end') listener({ type: 'tool_execution_end', toolName: event.toolName, isError: event.isError });
          else if (event.type === 'agent_end') listener({ type: 'agent_end', willRetry: event.willRetry });
        });
      },
      prompt: (text, promptOptions) => session.prompt(text, promptOptions),
      abort: () => session.abort(),
      dispose: () => session.dispose(),
    };
  };
}

export function createPiRuntime(options: { sessionFactory: PiSessionFactory }): {
  start: (input: PiRuntimeInput) => Promise<void>;
  abort: () => Promise<void>;
  dispose: () => void;
} {
  let session: PiSession | undefined;
  let unsubscribe: (() => void) | undefined;
  let removeAbortListener: (() => void) | undefined;
  let terminal = false;

  const emitTerminal = (input: PiRuntimeInput, event: PiRuntimeEvent): void => {
    if (terminal) return;
    terminal = true;
    input.emit(event);
  };

  const dispose = (): void => {
    removeAbortListener?.();
    removeAbortListener = undefined;
    unsubscribe?.();
    unsubscribe = undefined;
    session?.dispose();
    session = undefined;
  };

  return {
    async start(input) {
      if (session) throw new Error('Pi runtime is already running.');
      terminal = false;
      if (input.signal?.aborted) {
        emitTerminal(input, { type: 'cancelled' });
        return;
      }
      try {
        session = await options.sessionFactory(input);
        if (input.signal?.aborted) {
          await session.abort();
          emitTerminal(input, { type: 'cancelled' });
          return;
        }
        unsubscribe = session.subscribe((event) => {
          if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') input.emit({ type: 'text_delta', delta: event.assistantMessageEvent.delta });
          else if (event.type === 'tool_execution_start') input.emit({ type: 'tool_start', toolName: event.toolName });
          else if (event.type === 'tool_execution_end') input.emit({ type: 'tool_end', toolName: event.toolName, isError: event.isError });
          else if (event.type === 'agent_end' && !event.willRetry) emitTerminal(input, { type: 'completed' });
        });
        if (input.signal) {
          const onAbort = () => { void this.abort(); };
          input.signal.addEventListener('abort', onAbort, { once: true });
          removeAbortListener = () => input.signal?.removeEventListener('abort', onAbort);
        }
        await session.prompt(input.prompt, input.images.length > 0 ? { images: input.images } : undefined);
        emitTerminal(input, input.signal?.aborted ? { type: 'cancelled' } : { type: 'completed' });
      } catch (error) {
        if (input.signal?.aborted) emitTerminal(input, { type: 'cancelled' });
        else emitTerminal(input, { type: 'failed', error: error instanceof Error ? error.message : 'Pi runtime failed.' });
        throw error;
      }
    },
    async abort() {
      if (!session) return;
      await session.abort();
    },
    dispose,
  };
}
