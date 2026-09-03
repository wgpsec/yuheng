import assert from 'node:assert/strict';
import test from 'node:test';
import { createRunCancellation } from '../frontend/src/production/temporary-ai';

test('cancels a run after start binds an id when timeout wins during start', async () => {
  const cancelled: string[] = [];
  const cancellation = createRunCancellation(async (runId) => { cancelled.push(runId); });

  await cancellation.request();
  assert.equal(cancellation.requested(), true);
  await cancellation.bind('run-after-timeout');
  await cancellation.request();

  assert.deepEqual(cancelled, ['run-after-timeout']);
});

test('deduplicates repeated cancellation requests', async () => {
  let calls = 0;
  const cancellation = createRunCancellation(async () => { calls += 1; });
  await Promise.all([cancellation.bind('run-1'), cancellation.request(), cancellation.request()]);
  assert.equal(calls, 1);
});
