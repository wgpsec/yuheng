import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPiRuntime, createToolCallIdResolver, type PiSession, type PiSessionEvent, type PiRuntimeEvent, type PiRuntimeInput } from '../electron/pi-runtime';

function input(overrides: Partial<PiRuntimeInput> = {}): PiRuntimeInput {
  return {
    prompt: '整理这段内容',
    images: [],
    sessionId: 'session-1',
    cwd: '/tmp/yuheng-test',
    emit: () => undefined,
    ...overrides,
  };
}

describe('PiRuntime', () => {
  it('keeps repeated missing-id tool calls distinct and pairs their end events', () => {
    const resolver = createToolCallIdResolver();
    const first = resolver.start(undefined, 'read');
    const second = resolver.start(undefined, 'read');
    assert.notEqual(first, second);
    assert.equal(resolver.end(undefined, 'read'), first);
    assert.equal(resolver.end(undefined, 'read'), second);
  });

  it('forwards assistant text deltas and finishes once when a Pi session ends', async () => {
    const events: string[] = [];
    let sessionListener: ((event: PiSessionEvent) => void) | undefined;
    const session: PiSession = {
      subscribe(listener) { sessionListener = listener; return () => { sessionListener = undefined; }; },
      async prompt() {
        sessionListener?.({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '好的' } });
        sessionListener?.({ type: 'agent_end' });
      },
      async abort() {},
      dispose() {},
    };
    const runtime = createPiRuntime({ sessionFactory: async () => session });

    await runtime.start(input({ emit: (event) => events.push(event.type === 'text_delta' ? event.delta : event.type) }));

    assert.deepEqual(events, ['好的', 'completed']);
  });

  it('maps tool execution lifecycle events without duplicating completion', async () => {
    const events: PiRuntimeEvent[] = [];
    let sessionListener: ((event: PiSessionEvent) => void) | undefined;
    const session: PiSession = {
      subscribe(listener) { sessionListener = listener; return () => { sessionListener = undefined; }; },
      async prompt() {
        sessionListener?.({ type: 'tool_execution_start', toolCallId: 'tool-1', toolName: 'read', args: { path: 'notes.md' } });
        sessionListener?.({ type: 'tool_execution_end', toolCallId: 'tool-1', toolName: 'read', isError: false, result: { content: 'ok' } });
        sessionListener?.({ type: 'agent_end' });
      },
      async abort() {},
      dispose() {},
    };
    const runtime = createPiRuntime({ sessionFactory: async () => session });

    await runtime.start(input({ emit: (event) => events.push(event) }));

    assert.deepEqual(events, [
      { type: 'tool_start', toolCallId: 'tool-1', toolName: 'read', args: { path: 'notes.md' } },
      { type: 'tool_end', toolCallId: 'tool-1', toolName: 'read', isError: false, result: { content: 'ok' } },
      { type: 'completed' },
    ]);
  });

  it('reports the current turn usage separately from earlier session usage', async () => {
    const events: PiRuntimeEvent[] = [];
    let sessionListener: ((event: PiSessionEvent) => void) | undefined;
    let statsCall = 0;
    const session: PiSession = {
      subscribe(listener) { sessionListener = listener; return () => { sessionListener = undefined; }; },
      async prompt() { sessionListener?.({ type: 'agent_end' }); },
      async abort() {},
      dispose() {},
      stats() {
        statsCall += 1;
        return statsCall === 1
          ? { tokens: { input: 100, output: 20, total: 120 }, contextUsage: { tokens: 700, contextWindow: 128000, percent: 0.55 } }
          : { tokens: { input: 180, output: 45, total: 225 }, contextUsage: { tokens: 1100, contextWindow: 128000, percent: 0.86 } };
      },
    };
    const runtime = createPiRuntime({ sessionFactory: async () => session });

    await runtime.start(input({ emit: (event) => events.push(event) }));

    assert.deepEqual(events, [{ type: 'completed', usage: { inputTokens: 80, outputTokens: 25, totalTokens: 105, contextTokens: 1100, contextWindow: 128000, contextPercent: 0.86 } }]);
  });

  it('does not finish on an agent_end event that schedules a retry', async () => {
    const events: string[] = [];
    let sessionListener: ((event: PiSessionEvent) => void) | undefined;
    let resolvePrompt: (() => void) | undefined;
    const session: PiSession = {
      subscribe(listener) { sessionListener = listener; return () => { sessionListener = undefined; }; },
      async prompt() {
        sessionListener?.({ type: 'agent_end', willRetry: true });
        await new Promise<void>((resolve) => { resolvePrompt = resolve; });
      },
      async abort() {},
      dispose() {},
    };
    const runtime = createPiRuntime({ sessionFactory: async () => session });

    const running = runtime.start(input({ emit: (event) => events.push(event.type) }));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(events, []);
    resolvePrompt?.();
    await running;

    assert.deepEqual(events, ['completed']);
  });

  it('aborts the active Pi session and disposes it', async () => {
    let aborted = 0;
    let disposed = 0;
    const session: PiSession = {
      subscribe() { return () => undefined; },
      async prompt() {},
      async abort() { aborted += 1; },
      dispose() { disposed += 1; },
    };
    const runtime = createPiRuntime({ sessionFactory: async () => session });

    await runtime.start(input());
    await runtime.abort();
    runtime.dispose();

    assert.equal(aborted, 1);
    assert.equal(disposed, 1);
  });

  it('awaits the extension-aware shutdown hook when provided', async () => {
    let shutdownStarted = false;
    let shutdownFinished = false;
    const session: PiSession = {
      subscribe() { return () => undefined; },
      async prompt() {},
      async abort() {},
      dispose() { throw new Error('dispose should not be used when shutdown is available'); },
      async shutdown() {
        shutdownStarted = true;
        await new Promise<void>((resolve) => setImmediate(resolve));
        shutdownFinished = true;
      },
    };
    const runtime = createPiRuntime({ sessionFactory: async () => session });
    await runtime.start(input());
    await runtime.dispose();
    assert.equal(shutdownStarted, true);
    assert.equal(shutdownFinished, true);
  });

  it('reports cancellation when abort wins while prompt is settling', async () => {
    const events: string[] = [];
    let resolvePrompt: (() => void) | undefined;
    let abortRequested = false;
    const session: PiSession = {
      subscribe() { return () => undefined; },
      prompt: async () => new Promise<void>((resolve) => { resolvePrompt = resolve; }),
      async abort() { abortRequested = true; resolvePrompt?.(); },
      dispose() {},
    };
    const controller = new AbortController();
    const runtime = createPiRuntime({ sessionFactory: async () => session });
    const running = runtime.start(input({ signal: controller.signal, emit: (event) => events.push(event.type) }));

    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();
    await running;

    assert.equal(abortRequested, true);
    assert.deepEqual(events, ['cancelled']);
  });

  it('passes image attachments to the Pi prompt unchanged', async () => {
    let receivedImages: unknown;
    const session: PiSession = {
      subscribe() { return () => undefined; },
      async prompt(_text, options) { receivedImages = options?.images; },
      async abort() {},
      dispose() {},
    };
    const runtime = createPiRuntime({ sessionFactory: async () => session });
    const images = [{ type: 'image' as const, data: 'encoded-image', mimeType: 'image/png' }];

    await runtime.start(input({ images }));

    assert.deepEqual(receivedImages, images);
  });

  it('does not create a Pi session when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    let factoryCalls = 0;
    const events: string[] = [];
    const runtime = createPiRuntime({ sessionFactory: async () => {
      factoryCalls += 1;
      throw new Error('session should not be created');
    } });

    await runtime.start(input({ signal: controller.signal, emit: (event) => events.push(event.type) }));

    assert.equal(factoryCalls, 0);
    assert.deepEqual(events, ['cancelled']);
  });

  it('aborts a session created after cancellation during initialization', async () => {
    const controller = new AbortController();
    let resolveFactory: ((session: PiSession) => void) | undefined;
    let aborted = 0;
    const session: PiSession = {
      subscribe() { return () => undefined; },
      async prompt() { throw new Error('prompt should not run'); },
      async abort() { aborted += 1; },
      dispose() {},
    };
    const runtime = createPiRuntime({ sessionFactory: async () => new Promise<PiSession>((resolve) => { resolveFactory = resolve; }) });
    const events: string[] = [];
    const running = runtime.start(input({ signal: controller.signal, emit: (event) => events.push(event.type) }));
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();
    resolveFactory?.(session);
    await running;

    assert.equal(aborted, 1);
    assert.deepEqual(events, ['cancelled']);
  });
});
