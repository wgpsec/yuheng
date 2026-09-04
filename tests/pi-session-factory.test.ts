import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createPiSessionFactory, type PiRuntimeInput } from '../electron/pi-runtime';
import { BROWSER_TOOL_NAMES } from '../electron/browser-use';
import { COMPUTER_USE_TOOL_NAMES } from '../electron/computer-use';
import { TASK_TOOL_NAMES, type TaskToolService } from '../electron/task-agent-tools';

const emptyTaskService: TaskToolService = {
  listBoards: () => [],
  listTypes: () => [],
  listTasks: () => [],
  createTask: () => { throw new Error('not expected'); },
  updateTask: () => { throw new Error('not expected'); },
  taskChanged: () => undefined,
};

describe('Pi SDK session factory', () => {
  it('blocks image content for text-only providers and preserves it for multimodal providers', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'yuheng-pi-images-'));
    const requestBodies: string[] = [];
    const server = http.createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      requestBodies.push(body);
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(`data: ${JSON.stringify({ id: 'mock', choices: [{ index: 0, delta: { role: 'assistant', content: '收到' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const image = { type: 'image' as const, data: 'aGVsbG8=', mimeType: 'image/png' };
    try {
      for (const supportsImages of [false, true]) {
        const session = await createPiSessionFactory({ protocol: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'test-model', displayName: '测试模型', contextWindow: 200_000, supportsImages, hasApiKey: false }, 'test-key', { agentDir: path.join(root, 'agent', String(supportsImages)) })({ prompt: '查看图片', images: [], sessionId: `session-images-${supportsImages}`, cwd: root, emit: () => undefined });
        await session.prompt('查看图片', { images: [image] });
        session.dispose();
      }
      const blocked = JSON.stringify(JSON.parse(requestBodies[0] ?? '{}'));
      const allowed = JSON.stringify(JSON.parse(requestBodies[1] ?? '{}'));
      assert.match(blocked, /Image reading is disabled/);
      assert.doesNotMatch(blocked, /aGVsbG8=/);
      assert.match(allowed, /aGVsbG8=/);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects Browser Use and Computer Use together for a session', () => {
    assert.throws(() => createPiSessionFactory({ protocol: 'openai', baseUrl: 'https://api.example.test/v1', model: 'test-model', displayName: '测试模型', contextWindow: 200_000, hasApiKey: false }, 'test-key', {
      agentDir: '/tmp/yuheng-agent',
      browserUse: { supervisor: { callTool: async () => ({ content: [] }) }, requestApproval: async () => true },
      computerUse: { requestApproval: async () => true },
    }), /不能同时开启/);
  });
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
        contextWindow: 320_000,
        hasApiKey: false,
      }, 'test-key', { agentDir: path.join(root, 'agent') })(input);

      assert.equal(typeof session.prompt, 'function');
      assert.equal(session.stats?.().contextUsage?.contextWindow, 320_000);
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
      const session = await createPiSessionFactory({ protocol: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'test-model', displayName: '测试模型', contextWindow: 200_000, hasApiKey: false }, 'test-key', { agentDir: path.join(root, 'agent'), yuhengSystemPrompt: 'YUHENG_SYSTEM_PROMPT_SENTINEL', profilePrompt: 'PROFILE_PROMPT_SENTINEL', runtimeContext: '<runtime_context>NOW</runtime_context>' })({ prompt: 'hello', images: [], sessionId: 'session-test', cwd: root, emit: () => undefined });
      session.subscribe((event) => { if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') events.push(event.assistantMessageEvent.delta); });
      await session.prompt('hello');
      session.dispose();
      assert.deepEqual(events, ['你好']);
      assert.equal(requests.url, '/v1/chat/completions');
      assert.equal(requests.authorization, 'Bearer test-key');
      const payload = JSON.parse(requests.body ?? '{}');
      assert.equal(payload.model, 'test-model');
      assert.equal(payload.reasoning_effort, undefined);
      assert.deepEqual(payload.tools.map((tool: { function: { name: string } }) => tool.function.name).sort(), ['bash', 'edit', 'read', 'write']);
      const systemPrompt = payload.messages.find((message: { role: string }) => message.role === 'system')?.content ?? '';
      assert.match(systemPrompt, /You are an expert coding assistant/);
      assert.match(systemPrompt, /YUHENG_SYSTEM_PROMPT_SENTINEL/);
      assert.match(systemPrompt, /PROFILE_PROMPT_SENTINEL/);
      assert.match(systemPrompt, /<runtime_context>NOW<\/runtime_context>/);
      assert.doesNotMatch(systemPrompt, /<name>computer-use<\/name>/);
      assert.equal(JSON.stringify(payload).includes('DO NOT SEND THIS HIDDEN INSTRUCTION'), false);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });

  it('restores structured conversation history across separate runtime instances', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'yuheng-pi-'));
    const requestBodies: string[] = [];
    const server = http.createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      requestBodies.push(body);
      const answer = requestBodies.length === 1 ? '第一轮回答' : '第二轮回答';
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(`data: ${JSON.stringify({ id: 'mock', choices: [{ index: 0, delta: { role: 'assistant', content: answer }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const config = { protocol: 'openai' as const, baseUrl: `http://127.0.0.1:${port}/v1`, model: 'test-model', displayName: '测试模型', contextWindow: 200_000, hasApiKey: false };
    const options = { agentDir: path.join(root, 'agent') };
    const input = { images: [], sessionId: 'conversation-one', cwd: root, emit: () => undefined };
    try {
      const first = await createPiSessionFactory(config, 'test-key', options)({ ...input, prompt: '第一轮问题' });
      await first.prompt('第一轮问题');
      await first.shutdown?.();

      const second = await createPiSessionFactory(config, 'test-key', options)({ ...input, prompt: '第二轮问题' });
      await second.prompt('第二轮问题');
      await second.shutdown?.();

      const messages = JSON.parse(requestBodies[1] ?? '{}').messages as Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>;
      const text = (content: string | Array<{ type: string; text?: string }>) => typeof content === 'string' ? content : content.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('');
      assert.deepEqual(messages.filter((message) => message.role !== 'system').map((message) => [message.role, text(message.content)]), [
        ['user', '第一轮问题'],
        ['assistant', '第一轮回答'],
        ['user', '第二轮问题'],
      ]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });

  it('seeds an upgraded conversation once without duplicating the current prompt', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'yuheng-pi-'));
    let requestBody = '';
    const server = http.createServer(async (request, response) => {
      for await (const chunk of request) requestBody += chunk;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(`data: ${JSON.stringify({ id: 'mock', choices: [{ index: 0, delta: { role: 'assistant', content: '继续回答' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const session = await createPiSessionFactory({ protocol: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'test-model', displayName: '测试模型', contextWindow: 200_000, hasApiKey: false }, 'test-key', {
        agentDir: path.join(root, 'agent'),
      })({ prompt: '新问题', images: [], sessionId: 'upgraded-conversation', cwd: root, emit: () => undefined,
        history: [
          { role: 'user', content: '旧问题', createdAt: '2026-08-28T01:00:00.000Z' },
          { role: 'assistant', content: '旧回答', createdAt: '2026-08-28T01:00:01.000Z' },
        ],
      });
      await session.prompt('新问题');
      await session.shutdown?.();

      const messages = JSON.parse(requestBody || '{}').messages as Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>;
      const text = (content: string | Array<{ type: string; text?: string }>) => typeof content === 'string' ? content : content.map((part) => part.text ?? '').join('');
      assert.deepEqual(messages.filter((message) => message.role !== 'system').map((message) => [message.role, text(message.content)]), [
        ['user', '旧问题'],
        ['assistant', '旧回答'],
        ['user', '新问题'],
      ]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not branch from an unrelated user message when replay identity does not match', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'yuheng-pi-'));
    const requestBodies: string[] = [];
    const server = http.createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      requestBodies.push(body);
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(`data: ${JSON.stringify({ id: 'mock', choices: [{ index: 0, delta: { role: 'assistant', content: '回答' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const config = { protocol: 'openai' as const, baseUrl: `http://127.0.0.1:${port}/v1`, model: 'test-model', displayName: '测试模型', contextWindow: 200_000, hasApiKey: false };
    const options = { agentDir: path.join(root, 'agent') };
    const input = { images: [], sessionId: 'replay-mismatch', cwd: root, emit: () => undefined };
    try {
      const first = await createPiSessionFactory(config, 'test-key', options)({ ...input, prompt: '第一问' });
      await first.prompt('第一问');
      await first.shutdown?.();

      const second = await createPiSessionFactory(config, 'test-key', options)({ ...input, prompt: '第二问' });
      await second.prompt('第二问');
      await second.shutdown?.();

      const replay = await createPiSessionFactory(config, 'test-key', options)({
        ...input,
        prompt: '重试问题',
        replayUser: { ordinal: 0, content: '已经不存在的原文' },
      });
      await replay.prompt('重试问题');
      await replay.shutdown?.();

      const messages = JSON.parse(requestBodies[2] ?? '{}').messages as Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>;
      const text = (content: string | Array<{ type: string; text?: string }>) => typeof content === 'string' ? content : content.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('');
      assert.deepEqual(messages.filter((message) => message.role !== 'system').map((message) => [message.role, text(message.content)]), [
        ['user', '第一问'], ['assistant', '回答'], ['user', '第二问'], ['assistant', '回答'], ['user', '重试问题'],
      ]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });

  it('sends an explicitly selected extended reasoning level to an OpenAI-compatible provider', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'yuheng-pi-'));
    let requestBody = '';
    const server = http.createServer(async (request, response) => {
      for await (const chunk of request) requestBody += chunk;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(`data: ${JSON.stringify({ id: 'mock', choices: [{ index: 0, delta: { role: 'assistant', content: '完成' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const session = await createPiSessionFactory({ protocol: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'test-model', displayName: '测试模型', contextWindow: 200_000, hasApiKey: false }, 'test-key', {
        agentDir: path.join(root, 'agent'),
        thinkingLevel: 'xhigh',
      })({ prompt: '分析问题', images: [], sessionId: 'session-reasoning', cwd: root, emit: () => undefined });
      await session.prompt('分析问题');
      session.dispose();

      assert.equal(JSON.parse(requestBody).reasoning_effort, 'xhigh');
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
      const session = await createPiSessionFactory({ protocol: 'anthropic', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'test-model', displayName: '测试模型', contextWindow: 200_000, hasApiKey: false }, 'test-key', { agentDir: path.join(root, 'agent') })({ prompt: 'hello', images: [], sessionId: 'session-test', cwd: root, emit: () => undefined });
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

  it('only advertises Browser Use tools when the plugin is enabled for the session', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'yuheng-pi-'));
    let requestBody = '';
    const server = http.createServer(async (request, response) => {
      for await (const chunk of request) requestBody += chunk;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(`data: ${JSON.stringify({ id: 'mock', choices: [{ index: 0, delta: { role: 'assistant', content: '完成' }, finish_reason: null }] })}\n\n`);
      response.end(`data: ${JSON.stringify({ id: 'mock', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const session = await createPiSessionFactory({ protocol: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'test-model', displayName: '测试模型', contextWindow: 200_000, hasApiKey: false }, 'test-key', {
        agentDir: path.join(root, 'agent'),
        browserUse: {
          supervisor: { async callTool() { return { content: [{ type: 'text', text: 'ok' }] }; } },
          requestApproval: async () => true,
        },
      })({ prompt: 'open example.com', images: [], sessionId: 'session-browser', cwd: root, emit: () => undefined });
      await session.prompt('open example.com');
      session.dispose();
      const payload = JSON.parse(requestBody || '{}');
      const names = payload.tools.map((tool: { function: { name: string } }) => tool.function.name);
      assert.deepEqual(BROWSER_TOOL_NAMES.filter((name) => !names.includes(name)), []);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });

  it('loads the opt-in Computer Use extension and advertises desktop and managed browser tools', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'yuheng-pi-'));
    let requestBody = '';
    const server = http.createServer(async (_request, response) => {
      for await (const chunk of _request) requestBody += chunk;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(`data: ${JSON.stringify({ id: 'mock', choices: [{ index: 0, delta: { role: 'assistant', content: '完成' }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'mock', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const session = await createPiSessionFactory({ protocol: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'test-model', displayName: '测试模型', contextWindow: 200_000, hasApiKey: false }, 'test-key', {
        agentDir: path.join(root, 'agent'),
        computerUse: { requestApproval: async () => true },
      })({ prompt: '查看桌面', images: [], sessionId: 'session-computer', cwd: root, emit: () => undefined });
      await session.prompt('查看桌面');
      await session.shutdown?.();
      const payload = JSON.parse(requestBody || '{}');
      const names = payload.tools.map((tool: { function: { name: string } }) => tool.function.name);
      assert.deepEqual(COMPUTER_USE_TOOL_NAMES.filter((name) => !names.includes(name)), []);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });

  it('loads the controlled Computer Use skill only when desktop capability is enabled', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'yuheng-pi-'));
    let requestBody = '';
    const server = http.createServer(async (request, response) => {
      for await (const chunk of request) requestBody += chunk;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(`data: ${JSON.stringify({ id: 'mock', choices: [{ index: 0, delta: { role: 'assistant', content: '完成' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const config = { protocol: 'openai' as const, baseUrl: `http://127.0.0.1:${port}/v1`, model: 'test-model', displayName: '测试模型', contextWindow: 200_000, hasApiKey: false };
    try {
      const session = await createPiSessionFactory(config, 'test-key', {
        agentDir: path.join(root, 'agent'),
        applicationPath: process.cwd(),
        computerUse: { requestApproval: async () => true },
      })({ prompt: '查看桌面', images: [], sessionId: 'session-computer-skill', cwd: root, emit: () => undefined });
      await session.prompt('查看桌面');
      await session.shutdown?.();
      const systemPrompt = JSON.parse(requestBody || '{}').messages.find((message: { role: string }) => message.role === 'system')?.content ?? '';
      assert.match(systemPrompt, /<name>computer-use<\/name>/);
      assert.match(systemPrompt, /electron\/skills\/computer-use\/SKILL\.md/);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });

  it('advertises local task tools when a task service is provided', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'yuheng-pi-'));
    let requestBody = '';
    const server = http.createServer(async (request, response) => {
      for await (const chunk of request) requestBody += chunk;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(`data: ${JSON.stringify({ id: 'mock', choices: [{ index: 0, delta: { role: 'assistant', content: '完成' }, finish_reason: null }] })}\n\n`);
      response.end(`data: ${JSON.stringify({ id: 'mock', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const session = await createPiSessionFactory({ protocol: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'test-model', displayName: '测试模型', contextWindow: 200_000, hasApiKey: false }, 'test-key', {
        agentDir: path.join(root, 'agent'),
        taskService: emptyTaskService,
      })({ prompt: '创建一个任务', images: [], sessionId: 'session-tasks', cwd: root, emit: () => undefined });
      await session.prompt('创建一个任务');
      session.dispose();
      const payload = JSON.parse(requestBody || '{}');
      const names = payload.tools.map((tool: { function: { name: string } }) => tool.function.name);
      assert.deepEqual(TASK_TOOL_NAMES.filter((name) => !names.includes(name)), []);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });

  it('executes a task tool requested by the model and returns its result to the next turn', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'yuheng-pi-'));
    const requestBodies: string[] = [];
    let listBoardsCalls = 0;
    const taskService: TaskToolService = {
      ...emptyTaskService,
      listBoards: () => {
        listBoardsCalls += 1;
        return [{ id: 'board-1', name: '个人任务', position: 0, createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z' }];
      },
    };
    const server = http.createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      requestBodies.push(body);
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      if (requestBodies.length === 1) {
        response.write(`data: ${JSON.stringify({ id: 'mock-tool', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'task-call-1', type: 'function', function: { name: 'task_list', arguments: '{}' } }] }, finish_reason: null }] })}\n\n`);
        response.end(`data: ${JSON.stringify({ id: 'mock-tool', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`);
        return;
      }
      response.write(`data: ${JSON.stringify({ id: 'mock-result', choices: [{ index: 0, delta: { role: 'assistant', content: '已读取任务看板' }, finish_reason: null }] })}\n\n`);
      response.end(`data: ${JSON.stringify({ id: 'mock-result', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const session = await createPiSessionFactory({ protocol: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'test-model', displayName: '测试模型', contextWindow: 200_000, hasApiKey: false }, 'test-key', {
        agentDir: path.join(root, 'agent'),
        taskService,
      })({ prompt: '查看我的任务看板', images: [], sessionId: 'session-task-call', cwd: root, emit: () => undefined });
      await session.prompt('查看我的任务看板');
      session.dispose();

      assert.equal(listBoardsCalls, 1);
      assert.equal(requestBodies.length, 2);
      const secondPayload = JSON.parse(requestBodies[1]);
      const toolResult = secondPayload.messages.find((message: { role: string }) => message.role === 'tool');
      assert.equal(toolResult.tool_call_id, 'task-call-1');
      assert.match(toolResult.content, /board-1/);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });
});
