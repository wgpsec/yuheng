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
  it('rejects enabling Browser Use and Computer Use together', () => {
    assert.throws(() => createPiSessionFactory({ protocol: 'openai', baseUrl: 'https://api.example.test/v1', model: 'test-model', displayName: '测试模型', hasApiKey: false }, 'test-key', {
      agentDir: '/tmp/yuheng-agent',
      browserUse: { supervisor: { callTool: async () => ({ content: [] }) }, requestApproval: async () => true },
      computerUse: { requestApproval: async () => true },
    }), /cannot be enabled together/);
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
      const session = await createPiSessionFactory({ protocol: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'test-model', displayName: '测试模型', hasApiKey: false }, 'test-key', { agentDir: path.join(root, 'agent'), yuhengSystemPrompt: 'YUHENG_SYSTEM_PROMPT_SENTINEL' })({ prompt: 'hello', images: [], sessionId: 'session-test', cwd: root, emit: () => undefined });
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
      assert.equal(JSON.stringify(payload).includes('DO NOT SEND THIS HIDDEN INSTRUCTION'), false);
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
      const session = await createPiSessionFactory({ protocol: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'test-model', displayName: '测试模型', hasApiKey: false }, 'test-key', {
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
      const session = await createPiSessionFactory({ protocol: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'test-model', displayName: '测试模型', hasApiKey: false }, 'test-key', {
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
      const session = await createPiSessionFactory({ protocol: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'test-model', displayName: '测试模型', hasApiKey: false }, 'test-key', {
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
      const session = await createPiSessionFactory({ protocol: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'test-model', displayName: '测试模型', hasApiKey: false }, 'test-key', {
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
      const session = await createPiSessionFactory({ protocol: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'test-model', displayName: '测试模型', hasApiKey: false }, 'test-key', {
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
