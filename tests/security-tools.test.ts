import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createSecurityToolExtension } from '../electron/security-tools';

type ToolCallHandler = (
  event: { type: 'tool_call'; toolCallId: string; toolName: string; input: Record<string, unknown> },
  context: { signal?: AbortSignal },
) => unknown | Promise<unknown>;

async function registeredHandler(authorize: Parameters<typeof createSecurityToolExtension>[0]): Promise<ToolCallHandler> {
  let handler: ToolCallHandler | undefined;
  const extension = createSecurityToolExtension(authorize);
  await extension({
    on(event: string, candidate: unknown) {
      if (event === 'tool_call') handler = candidate as ToolCallHandler;
    },
  } as unknown as ExtensionAPI);
  assert.ok(handler);
  return handler;
}

describe('security tool extension', () => {
  it('allows an authorized tool call and forwards its identity and signal', async () => {
    const controller = new AbortController();
    let received: unknown;
    const handler = await registeredHandler(async (request) => {
      received = request;
      return true;
    });
    const result = await handler(
      { type: 'tool_call', toolCallId: 'call-1', toolName: 'read', input: { path: 'README.md' } },
      { signal: controller.signal },
    );
    assert.equal(result, undefined);
    assert.deepEqual(received, { toolCallId: 'call-1', toolName: 'read', input: { path: 'README.md' }, signal: controller.signal });
  });

  it('blocks and terminates a denied tool call before execution', async () => {
    const handler = await registeredHandler(async () => false);
    assert.deepEqual(await handler(
      { type: 'tool_call', toolCallId: 'call-2', toolName: 'bash', input: { command: 'rm file' } },
      {},
    ), { block: true, reason: '安全策略拒绝了这次工具操作。', terminate: true });
  });
});
