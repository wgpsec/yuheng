import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApprovalCoordinator } from '../electron/runs/approval-coordinator';
import { RunCoordinator } from '../electron/runs/run-coordinator';

describe('RunCoordinator', () => {
  it('owns active conversation admission, cancellation, and one-time finish', () => {
    const coordinator = new RunCoordinator();
    const controller = new AbortController();
    coordinator.start('run-1', { controller, conversationId: 'conversation-1', inputMessageId: 'message-1', permissionMode: 'ask' });

    assert.equal(coordinator.hasActiveConversation('conversation-1'), true);
    assert.throws(() => coordinator.start('run-2', { controller: new AbortController(), conversationId: 'conversation-1', inputMessageId: 'message-2', permissionMode: 'ask' }), /仍在处理中/);
    coordinator.cancel('run-1');
    assert.equal(controller.signal.aborted, true);
    assert.ok(coordinator.finish('run-1'));
    assert.equal(coordinator.finish('run-1'), undefined);
    assert.equal(coordinator.size, 0);
  });

  it('waits for active runs to unwind and returns immediately once idle', async () => {
    const coordinator = new RunCoordinator();
    coordinator.start('run-1', { controller: new AbortController(), conversationId: 'conversation-1', inputMessageId: 'message-1', permissionMode: 'ask' });
    const waiting = coordinator.waitForIdle(1_000);
    setImmediate(() => coordinator.finish('run-1'));
    await waiting;
    await coordinator.waitForIdle(1_000);
    assert.equal(coordinator.size, 0);
  });
});

describe('ApprovalCoordinator', () => {
  it('rejects pending approval when its sender is destroyed', async () => {
    const events: string[] = [];
    const coordinator = new ApprovalCoordinator(() => 'approval-1');
    const result = coordinator.request({
      runId: 'run-1', senderId: 10,
      onRequired: (id) => events.push(`required:${id}`),
      onResolved: (id, approved) => events.push(`resolved:${id}:${approved}`),
    });
    coordinator.rejectSender(10);

    assert.equal(await result, false);
    assert.deepEqual(events, ['required:approval-1', 'resolved:approval-1:false']);
    assert.equal(coordinator.size, 0);
  });

  it('accepts only the owning sender and closes idempotently', async () => {
    const coordinator = new ApprovalCoordinator(() => 'approval-1');
    const result = coordinator.request({ runId: 'run-1', senderId: 10, onRequired: () => {}, onResolved: () => {} });
    coordinator.resolve('approval-1', 20, true);
    assert.equal(coordinator.size, 1);
    coordinator.resolve('approval-1', 10, true);
    assert.equal(await result, true);
    coordinator.close();
    coordinator.close();
  });

  it('rejects on abort and timeout without leaving pending approvals', async () => {
    const controller = new AbortController();
    const aborted = new ApprovalCoordinator(() => 'approval-abort');
    const abortResult = aborted.request({ runId: 'run-1', senderId: 10, signal: controller.signal, onRequired: () => {}, onResolved: () => {} });
    controller.abort();
    assert.equal(await abortResult, false);
    assert.equal(aborted.size, 0);

    const timedOut = new ApprovalCoordinator(() => 'approval-timeout');
    assert.equal(await timedOut.request({ runId: 'run-2', senderId: 20, timeoutMs: 1, onRequired: () => {}, onResolved: () => {} }), false);
    assert.equal(timedOut.size, 0);
  });
});
