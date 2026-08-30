import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  ToolSecurityBroker,
  ToolSecurityPolicy,
  redactToolApprovalInput,
  type SecurityAuditEvent,
} from '../electron/security-policy';

describe('tool security policy', () => {
  it('allows reads inside the managed workspace and escalates path escapes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'yuheng-security-'));
    const workspace = path.join(root, 'workspace');
    const outside = path.join(root, 'outside');
    await mkdir(workspace);
    await mkdir(outside);
    await writeFile(path.join(workspace, 'inside.txt'), 'inside');
    await writeFile(path.join(outside, 'outside.txt'), 'outside');
    await symlink(outside, path.join(workspace, 'linked'));
    const policy = new ToolSecurityPolicy(workspace);

    assert.equal((await policy.evaluate('read', { path: 'inside.txt' })).action, 'allow');
    assert.equal((await policy.evaluate('grep', { pattern: 'inside' })).action, 'allow');
    assert.equal((await policy.evaluate('find', { pattern: '*.txt', path: '.' })).action, 'allow');
    assert.equal((await policy.evaluate('ls', {})).action, 'allow');
    assert.equal((await policy.evaluate('read', { path: '../outside/outside.txt' })).action, 'approve');
    assert.equal((await policy.evaluate('grep', { pattern: 'outside', path: '../outside' })).action, 'approve');
    assert.equal((await policy.evaluate('read', { path: 'linked/outside.txt' })).action, 'approve');
  });

  it('requires approval for mutations, shell commands, and unknown tools', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'yuheng-security-'));
    const policy = new ToolSecurityPolicy(workspace);

    for (const [toolName, input] of [
      ['write', { path: 'note.md', content: 'content' }],
      ['edit', { path: 'note.md', edits: [] }],
      ['bash', { command: 'pwd' }],
      ['task_create', { board_id: 'default', title: 'Task' }],
      ['task_update', { task_id: 'task-1', title: 'Changed' }],
      ['future_external_tool', {}],
    ] as const) assert.equal((await policy.evaluate(toolName, input)).action, 'approve', toolName);

    assert.equal((await policy.evaluate('task_list', {})).action, 'allow');
    assert.equal((await policy.evaluate('browser_get_state', {})).action, 'allow');
    assert.equal((await policy.evaluate('observe_ui', {})).action, 'allow');
  });

  it('allows contained writes and task changes in smart mode but keeps high-risk operations gated', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'yuheng-security-'));
    const workspace = path.join(root, 'workspace');
    await mkdir(workspace);
    const policy = new ToolSecurityPolicy(workspace, 'smart');

    assert.equal((await policy.evaluate('write', { path: 'note.md', content: 'content' })).action, 'allow');
    assert.equal((await policy.evaluate('edit', { path: 'note.md', edits: [] })).action, 'allow');
    assert.equal((await policy.evaluate('task_create', { title: 'Task' })).action, 'allow');
    assert.equal((await policy.evaluate('task_update', { task_id: 'task-1' })).action, 'allow');
    assert.equal((await policy.evaluate('bash', { command: 'pwd' })).action, 'approve');
    assert.equal((await policy.evaluate('write', { path: '../outside.txt', content: 'content' })).action, 'approve');
    assert.equal((await policy.evaluate('browser_click', { selector: '#submit' })).action, 'approve');
    assert.equal((await policy.evaluate('future_external_tool', {})).action, 'approve');
  });

  it('allows approval-gated tools in full session mode without bypassing hard denials', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'yuheng-security-'));
    const policy = new ToolSecurityPolicy(workspace, 'full_session');

    assert.equal((await policy.evaluate('bash', { command: 'pwd' })).action, 'allow');
    assert.equal((await policy.evaluate('browser_click', { selector: '#submit' })).action, 'allow');
    assert.equal((await policy.evaluate('future_external_tool', {})).action, 'allow');
    assert.equal((await policy.evaluate('read', {})).action, 'deny');
    assert.equal((await policy.evaluate('write', { path: '', content: 'content' })).action, 'deny');
  });

  it('binds approval and audit decisions to one run', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'yuheng-security-'));
    const events: SecurityAuditEvent[] = [];
    const broker = new ToolSecurityBroker({
      policy: new ToolSecurityPolicy(workspace),
      audit: { record: (event) => { events.push(event); } },
      requestApproval: async (request) => request.runId === 'run-1' && request.toolName === 'bash',
    });

    assert.equal(await broker.authorize({ runId: 'run-1', conversationId: 'conversation-1', toolCallId: 'call-1', toolName: 'bash', input: { command: 'pwd' } }), true);
    assert.deepEqual(events.map((event) => event.decision), ['approval_requested', 'approved']);
    assert.ok(events.every((event) => event.runId === 'run-1' && event.conversationId === 'conversation-1'));
  });

  it('redacts mutation payloads while leaving shell commands reviewable', () => {
    assert.deepEqual(redactToolApprovalInput('write', { path: 'note.md', content: 'secret text' }), { path: 'note.md', content: '<redacted:11 characters>' });
    assert.deepEqual(redactToolApprovalInput('edit', { path: 'note.md', edits: [{ oldText: 'old', newText: 'new value' }] }), {
      path: 'note.md', edits: [{ oldText: '<redacted:3 characters>', newText: '<redacted:9 characters>' }],
    });
    assert.deepEqual(redactToolApprovalInput('bash', { command: 'pwd' }), { command: 'pwd' });
  });
});
