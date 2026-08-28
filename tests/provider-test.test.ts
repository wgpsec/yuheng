import assert from 'node:assert/strict';
import test from 'node:test';
import { testProviderConnection } from '../electron/provider-test.ts';

const config = (protocol: 'openai' | 'anthropic') => ({ id: 'test', protocol, baseUrl: protocol === 'openai' ? 'https://example.test/v1' : 'https://example.test', model: 'demo', displayName: 'Demo', contextWindow: 200_000, hasApiKey: true });

test('tests OpenAI-compatible providers with a minimal request and no raw error leakage', async () => {
  let request: Request | undefined;
  const result = await testProviderConnection(config('openai'), 'secret-key', async (input, init) => {
    request = new Request(input, init);
    return new Response('{}', { status: 200 });
  });
  assert.equal(result.ok, true);
  assert.equal(new URL(request!.url).pathname, '/v1/chat/completions');
  assert.equal(request!.headers.get('authorization'), 'Bearer secret-key');
  assert.deepEqual(await request!.json(), { model: 'demo', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] });
});

test('tests Anthropic providers and returns structured failures', async () => {
  const result = await testProviderConnection(config('anthropic'), 'secret-key', async (input, init) => {
    const request = new Request(input, init);
    assert.equal(new URL(request.url).pathname, '/v1/messages');
    assert.equal(request.headers.get('x-api-key'), 'secret-key');
    return new Response(JSON.stringify({ error: { message: 'invalid secret-key model' } }), { status: 400 });
  });
  assert.deepEqual(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.error, 'invalid [redacted] model');
  assert.equal(result.error?.includes('secret-key'), false);
});

test('bounds provider connection attempts', async () => {
  const result = await testProviderConnection(config('openai'), 'secret-key', (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  }), 5);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Provider 请求超时。');
});
