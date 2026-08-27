import type { ExtensionFactory, ToolCallEvent } from '@earendil-works/pi-coding-agent';

export const COMPUTER_USE_VERSION = '0.5.0';
export const COMPUTER_USE_TOOL_NAMES = [
  'find_roots',
  'observe_ui',
  'search_ui',
  'expand_ui',
  'inspect_ui',
  'act_ui',
  'read_text',
  'wait_for',
  'launch_browser',
  'navigate_browser',
  'evaluate_browser',
] as const;

export type ComputerUseToolName = typeof COMPUTER_USE_TOOL_NAMES[number];
export type ComputerUseApproval = (toolCallId: string, toolName: ComputerUseToolName, args: Record<string, unknown>, signal?: AbortSignal) => Promise<boolean>;

export function computerUseExtensionPath(): string {
  return require.resolve('@injaneity/pi-computer-use/extensions/computer-use.ts');
}

export function redactComputerUseToolInput(toolName: string, value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const input = value as Record<string, unknown>;
  if (toolName === 'act_ui' && Array.isArray(input.actions)) {
    return {
      ...input,
      actions: input.actions.map((action) => {
        if (!action || typeof action !== 'object') return action;
        const item = action as Record<string, unknown>;
        if (typeof item.text !== 'string') return item;
        return { ...item, text: `<redacted:${item.text.length} characters>` };
      }),
    };
  }
  return toolName === 'evaluate_browser' && typeof input.expression === 'string'
    ? { ...input, expression: `<redacted:${input.expression.length} characters>` }
    : value;
}

function approvalRequired(toolName: ComputerUseToolName): boolean {
  return toolName === 'act_ui' || toolName === 'launch_browser' || toolName === 'navigate_browser' || toolName === 'evaluate_browser';
}

/** Adds host-owned approval without modifying the upstream extension. */
export function createComputerUseApprovalExtension(requestApproval: ComputerUseApproval): ExtensionFactory {
  return (pi) => {
    pi.on('tool_call', async (event: ToolCallEvent, ctx) => {
      if (!COMPUTER_USE_TOOL_NAMES.includes(event.toolName as ComputerUseToolName)) return undefined;
      const toolName = event.toolName as ComputerUseToolName;
      if (!approvalRequired(toolName)) return undefined;
      const approved = await requestApproval(event.toolCallId, toolName, event.input, ctx.signal);
      return approved ? undefined : { block: true, reason: '用户拒绝了这次 Computer Use 操作。', terminate: true };
    });
  };
}

/** Serializes sessions because pi-computer-use owns process-global native state. */
export class ComputerUseLease {
  private tail: Promise<void> = Promise.resolve();

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw new DOMException('Computer Use wait cancelled.', 'AbortError');
    let releasePrevious!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => { releasePrevious = resolve; });
    try {
      await this.waitFor(previous, signal);
    } catch (error) {
      releasePrevious();
      throw error;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      releasePrevious();
    };
  }

  private async waitFor(previous: Promise<void>, signal?: AbortSignal): Promise<void> {
    if (!signal) return previous;
    await Promise.race([
      previous,
      new Promise<never>((_, reject) => {
        const onAbort = () => reject(new DOMException('Computer Use wait cancelled.', 'AbortError'));
        signal.addEventListener('abort', onAbort, { once: true });
        previous.finally(() => signal.removeEventListener('abort', onAbort)).catch(() => undefined);
      }),
    ]);
  }
}
