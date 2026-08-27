import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ComputerUseLease, redactComputerUseToolInput } from '../electron/computer-use';

describe('Computer Use host integration', () => {
  it('redacts text and browser expressions from activity inputs', () => {
    const redacted = redactComputerUseToolInput('act_ui', { actions: [{ type: 'type', text: 'secret' }] }) as { actions: Array<{ text: string }> };
    assert.equal(redacted.actions[0].text, '<redacted:6 characters>');
    assert.deepEqual(redactComputerUseToolInput('evaluate_browser', { expression: 'document.cookie' }), { expression: '<redacted:15 characters>' });
  });

  it('serializes Computer Use sessions and releases the next waiter', async () => {
    const lease = new ComputerUseLease();
    const releaseFirst = await lease.acquire();
    let acquiredSecond = false;
    const second = lease.acquire().then((release) => { acquiredSecond = true; release(); });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(acquiredSecond, false);
    releaseFirst();
    await second;
    assert.equal(acquiredSecond, true);
  });

  it('cancels a queued session when its signal is aborted', async () => {
    const lease = new ComputerUseLease();
    const releaseFirst = await lease.acquire();
    const controller = new AbortController();
    const waiting = lease.acquire(controller.signal);
    controller.abort();
    await assert.rejects(waiting, { name: 'AbortError' });
    releaseFirst();
  });
});
