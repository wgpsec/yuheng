import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createPiSessionFactory, type PiRuntimeInput } from '../electron/pi-runtime';

describe('Pi SDK session factory', () => {
  it('creates an isolated session without contacting the model network', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'yuheng-pi-'));
    const input: PiRuntimeInput = {
      prompt: 'test',
      images: [],
      sessionId: 'session-test',
      cwd: root,
      emit: () => undefined,
    };
    try {
      const session = await createPiSessionFactory({
        protocol: 'openai',
        baseUrl: 'http://127.0.0.1:9/v1',
        model: 'test-model',
        displayName: '测试模型',
        hasApiKey: false,
      }, 'test-key', { agentDir: path.join(root, 'agent') })(input);

      assert.equal(typeof session.prompt, 'function');
      session.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('maps an OpenAI-compatible provider request into Pi text events', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'yuheng-pi-'));
    await writeFile(path.join(root, 'AGENTS.md'), 'DO NOT SEND THIS HIDDEN INSTRUCTION');
    const requests: { url?: string; authorization?: string; body?: string } = {};
    const server = http.createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      requests.url = request.url;
      requests.authorization = request.headers.authorization;
      requests.body = body;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(`data: ${JSON.stringify({ id: 'mock', choices: [{ index: 0, delta: { role: 'assistant', content: '你好' }, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ id: 'mock', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
      response.end('data: [DONE]\n\n');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const events: string[] = [];
    try {
      const session = await createPiSessionFactory({ protocol: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'test-model', displayName: '测试模型', hasApiKey: false }, 'test-key', { agentDir: path.join(root, 'agent') })({ prompt: 'hello', images: [], sessionId: 'session-test', cwd: root, emit: () => undefined });
      session.subscribe((event) => { if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') events.push(event.assistantMessageEvent.delta); });
      await session.prompt('hello');
      session.dispose();
      assert.deepEqual(events, ['你好']);
      assert.equal(requests.url, '/v1/chat/completions');
      assert.equal(requests.authorization, 'Bearer test-key');
      const payload = JSON.parse(requests.body ?? '{}');
      assert.equal(payload.model, 'test-model');
      assert.deepEqual(payload.tools.map((tool: { function: { name: string } }) => tool.function.name).sort(), ['bash', 'edit', 'read', 'write']);
      assert.equal(JSON.stringify(payload).includes('DO NOT SEND THIS HIDDEN INSTRUCTION'), false);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });

  it('maps an Anthropic Messages provider request into Pi text events', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'yuheng-pi-'));
    const requests: { url?: string; apiKey?: string } = {};
    const server = http.createServer(async (request, response) => {
      for await (const _chunk of request) { /* consume request before streaming */ }
      requests.url = request.url;
      requests.apiKey = request.headers['x-api-key'];
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: 'mock', role: 'assistant', content: [], model: 'test-model', stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } })}\n\n`);
      response.write(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`);
      response.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '你好' } })}\n\n`);
      response.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`);
      response.write(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } })}\n\n`);
      response.end('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const events: string[] = [];
    try {
      const session = await createPiSessionFactory({ protocol: 'anthropic', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'test-model', displayName: '测试模型', hasApiKey: false }, 'test-key', { agentDir: path.join(root, 'agent') })({ prompt: 'hello', images: [], sessionId: 'session-test', cwd: root, emit: () => undefined });
      session.subscribe((event) => { if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') events.push(event.assistantMessageEvent.delta); });
      await session.prompt('hello');
      session.dispose();
      assert.deepEqual(events, ['你好']);
      assert.equal(requests.url, '/v1/messages');
      assert.equal(requests.apiKey, 'test-key');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });
});
