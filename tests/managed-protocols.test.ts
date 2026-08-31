import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { registerManagedProtocols } from '../electron/protocols/register-managed-protocols';

describe('managed protocols', () => {
  it('registers every scheme and disposes them once in reverse order', () => {
    const handlers = new Map<string, unknown>();
    const removed: string[] = [];
    const protocol = {
      handle: (scheme: string, handler: unknown) => { handlers.set(scheme, handler); },
      unhandle: (scheme: string) => { removed.push(scheme); handlers.delete(scheme); },
    };
    const dispose = registerManagedProtocols(protocol as never, [
      { scheme: 'first', resolve: () => '/tmp/first' },
      { scheme: 'second', resolve: () => '/tmp/second' },
    ]);

    assert.deepEqual([...handlers.keys()], ['first', 'second']);
    dispose();
    dispose();
    assert.deepEqual(removed, ['second', 'first']);
    assert.equal(handlers.size, 0);
  });

  it('rolls back earlier schemes when registration fails', () => {
    const removed: string[] = [];
    const protocol = {
      handle: (scheme: string) => {
        if (scheme === 'second') throw new Error('registration failed');
      },
      unhandle: (scheme: string) => { removed.push(scheme); },
    };

    assert.throws(() => registerManagedProtocols(protocol as never, [
      { scheme: 'first', resolve: () => '/tmp/first' },
      { scheme: 'second', resolve: () => '/tmp/second' },
    ]), /registration failed/);
    assert.deepEqual(removed, ['first']);
  });
});
