import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolPermissionMode } from './permission-mode';

export type SecurityDecision = 'allowed' | 'approval_requested' | 'approved' | 'denied';
export type SecurityRisk = 'read' | 'write' | 'execute' | 'external';
export type ToolPolicyCategory = 'workspace_read' | 'workspace_mutation' | 'path_escape' | 'shell' | 'task_mutation' | 'external_effect' | 'safe' | 'unknown' | 'invalid';
export type ToolPolicyDecision = { action: 'allow' | 'approve' | 'deny'; risk: SecurityRisk; category: ToolPolicyCategory; reason: string };
export type SecurityAuditEvent = {
  timestamp: string;
  runId: string;
  conversationId: string;
  toolCallId: string;
  toolName: string;
  risk: SecurityRisk;
  decision: SecurityDecision;
  reason: string;
};
export type SecurityAuditSink = { record(event: SecurityAuditEvent): void | Promise<void> };
export type ToolAuthorizationRequest = {
  runId: string;
  conversationId: string;
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  signal?: AbortSignal;
};

const MUTATION_TOOLS = new Set(['write', 'edit', 'task_create', 'task_update']);
const FILE_READ_TOOLS = new Set(['read', 'grep', 'find', 'ls']);
const EXTERNAL_TOOLS = new Set([
  'browser_click', 'browser_type', 'browser_close_tab',
  'act_ui', 'launch_browser', 'navigate_browser', 'evaluate_browser',
]);
const SAFE_TOOLS = new Set([
  'task_list', 'browser_navigate', 'browser_get_state', 'browser_screenshot', 'browser_scroll', 'browser_go_back', 'browser_list_tabs', 'browser_switch_tab',
  'find_roots', 'observe_ui', 'search_ui', 'expand_ui', 'inspect_ui', 'read_text', 'wait_for',
]);

async function realTargetPath(workspace: string, rawPath: string): Promise<{ target: string; inside: boolean }> {
  const root = await fs.realpath(workspace);
  const absolute = path.resolve(workspace, rawPath);
  let existing = absolute;
  while (true) {
    try {
      const resolved = await fs.realpath(existing);
      const target = path.resolve(resolved, path.relative(existing, absolute));
      return { target, inside: target === root || target.startsWith(`${root}${path.sep}`) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw error;
      existing = parent;
    }
  }
}

export class ToolSecurityPolicy {
  constructor(private readonly workspace: string, private readonly mode: ToolPermissionMode = 'cautious') {}

  async evaluate(toolName: string, input: Record<string, unknown>): Promise<ToolPolicyDecision> {
    const decision = await this.evaluateBase(toolName, input);
    if (decision.action !== 'approve' || this.mode === 'cautious') return decision;
    if (this.mode === 'full_session') return { ...decision, action: 'allow', reason: `Allowed by full session access. ${decision.reason}` };
    if (decision.category === 'workspace_mutation' || decision.category === 'task_mutation') {
      return { ...decision, action: 'allow', reason: `Allowed by smart approval mode. ${decision.reason}` };
    }
    return decision;
  }

  private async evaluateBase(toolName: string, input: Record<string, unknown>): Promise<ToolPolicyDecision> {
    if (toolName === 'bash' || toolName === 'powershell') return { action: 'approve', risk: 'execute', category: 'shell', reason: 'Shell commands require explicit approval.' };
    if (FILE_READ_TOOLS.has(toolName)) {
      const rawPath = input.path ?? (toolName === 'read' ? undefined : '.');
      if (typeof rawPath !== 'string' || !rawPath.trim()) return { action: 'deny', risk: 'read', category: 'invalid', reason: 'A valid file path is required.' };
      const target = await realTargetPath(this.workspace, rawPath);
      if (target.inside) return { action: 'allow', risk: 'read', category: 'workspace_read', reason: 'Read is contained in the managed workspace.' };
      return { action: 'approve', risk: 'read', category: 'path_escape', reason: 'The requested path resolves outside the managed workspace.' };
    }
    if (toolName === 'write' || toolName === 'edit') {
      if (typeof input.path !== 'string' || !input.path.trim()) return { action: 'deny', risk: 'write', category: 'invalid', reason: 'A valid file path is required.' };
      const target = await realTargetPath(this.workspace, input.path);
      return {
        action: 'approve',
        risk: 'write',
        category: target.inside ? 'workspace_mutation' : 'path_escape',
        reason: target.inside ? 'Workspace mutations require explicit approval.' : 'The requested path resolves outside the managed workspace.',
      };
    }
    if (MUTATION_TOOLS.has(toolName)) return { action: 'approve', risk: 'write', category: 'task_mutation', reason: 'Persistent changes require explicit approval.' };
    if (EXTERNAL_TOOLS.has(toolName)) return { action: 'approve', risk: 'external', category: 'external_effect', reason: 'External side effects require explicit approval.' };
    if (SAFE_TOOLS.has(toolName)) return { action: 'allow', risk: toolName.startsWith('browser_') ? 'external' : 'read', category: 'safe', reason: 'This tool is read-only or navigational.' };
    return { action: 'approve', risk: 'external', category: 'unknown', reason: 'Unknown tools require explicit approval.' };
  }
}

function redactedText(value: unknown): unknown {
  return typeof value === 'string' ? `<redacted:${value.length} characters>` : value;
}

export function redactToolApprovalInput(toolName: string, input: Record<string, unknown>): Record<string, unknown> {
  if (toolName === 'write') return { ...input, content: redactedText(input.content) };
  if (toolName === 'edit' && Array.isArray(input.edits)) {
    return {
      ...input,
      edits: input.edits.map((edit) => edit && typeof edit === 'object'
        ? { ...(edit as Record<string, unknown>), oldText: redactedText((edit as Record<string, unknown>).oldText), newText: redactedText((edit as Record<string, unknown>).newText) }
        : edit),
    };
  }
  if (toolName === 'browser_type' && typeof input.text === 'string') return { ...input, text: redactedText(input.text) };
  if (toolName === 'act_ui' && Array.isArray(input.actions)) {
    return { ...input, actions: input.actions.map((action) => action && typeof action === 'object' && typeof (action as Record<string, unknown>).text === 'string' ? { ...(action as Record<string, unknown>), text: redactedText((action as Record<string, unknown>).text) } : action) };
  }
  if (toolName === 'evaluate_browser' && typeof input.expression === 'string') return { ...input, expression: redactedText(input.expression) };
  return input;
}

export class ToolSecurityBroker {
  constructor(private readonly options: {
    policy: ToolSecurityPolicy;
    requestApproval(request: ToolAuthorizationRequest): Promise<boolean>;
    audit: SecurityAuditSink;
  }) {}

  async authorize(request: ToolAuthorizationRequest): Promise<boolean> {
    const decision = await this.options.policy.evaluate(request.toolName, request.input);
    if (decision.action === 'allow') {
      await this.record(request, decision, 'allowed');
      return true;
    }
    if (decision.action === 'deny' || request.signal?.aborted) {
      await this.record(request, decision, 'denied');
      return false;
    }
    await this.record(request, decision, 'approval_requested');
    const approved = await this.options.requestApproval(request);
    await this.record(request, decision, approved ? 'approved' : 'denied');
    return approved;
  }

  private async record(request: ToolAuthorizationRequest, policy: ToolPolicyDecision, decision: SecurityDecision): Promise<void> {
    await this.options.audit.record({
      timestamp: new Date().toISOString(), runId: request.runId, conversationId: request.conversationId,
      toolCallId: request.toolCallId, toolName: request.toolName, risk: policy.risk, decision, reason: policy.reason,
    });
  }
}
