import type { ExtensionFactory, ToolCallEvent } from '@earendil-works/pi-coding-agent';
import type { ToolAuthorizationRequest } from './security-policy';

export type ToolAuthorizer = (request: Pick<ToolAuthorizationRequest, 'toolCallId' | 'toolName' | 'input' | 'signal'>) => Promise<boolean>;

export function createSecurityToolExtension(authorize: ToolAuthorizer): ExtensionFactory {
  return (pi) => {
    pi.on('tool_call', async (event: ToolCallEvent, ctx) => {
      const approved = await authorize({ toolCallId: event.toolCallId, toolName: event.toolName, input: event.input, signal: ctx.signal });
      return approved ? undefined : { block: true, reason: '安全策略拒绝了这次工具操作。', terminate: true };
    });
  };
}
