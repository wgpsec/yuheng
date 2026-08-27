import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

export const BROWSER_USE_VERSION = '0.13.8';
const BROWSER_USE_START_TIMEOUT_MS = 5 * 60_000;
export const BROWSER_TOOL_NAMES = [
  'browser_navigate',
  'browser_get_state',
  'browser_screenshot',
  'browser_click',
  'browser_type',
  'browser_scroll',
  'browser_go_back',
  'browser_list_tabs',
  'browser_switch_tab',
  'browser_close_tab',
] as const;

export type BrowserToolName = typeof BROWSER_TOOL_NAMES[number];
export type BrowserUseContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
export type BrowserUseToolResult = { content: BrowserUseContent[]; isError?: boolean };
export type BrowserUseClient = {
  callTool: (name: BrowserToolName, args: Record<string, unknown>, signal?: AbortSignal) => Promise<BrowserUseToolResult>;
  close: () => Promise<void>;
};

type BrowserUseSupervisorOptions = {
  dataDir: string;
  createClient?: (dataDir: string) => Promise<BrowserUseClient>;
};

function writeIsolatedConfig(dataDir: string): void {
  const configDir = path.join(dataDir, 'config');
  const profileDir = path.join(dataDir, 'profile');
  const downloadsDir = path.join(dataDir, 'downloads');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(downloadsDir, { recursive: true });
  const configPath = path.join(configDir, 'config.json');
  const config = {
    browser_profile: {
      yuheng: {
        id: 'yuheng',
        default: true,
        headless: false,
        user_data_dir: profileDir,
        downloads_path: downloadsDir,
        enable_default_extensions: false,
      },
    },
    llm: {},
    agent: {},
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
}

async function createMcpClient(dataDir: string): Promise<BrowserUseClient> {
  writeIsolatedConfig(dataDir);
  const configDir = path.join(dataDir, 'config');
  const transport = new StdioClientTransport({
    command: process.env.YUHENG_BROWSER_USE_COMMAND || 'uvx',
    args: ['--from', `browser-use==${BROWSER_USE_VERSION}`, 'browser-use', '--mcp'],
    env: {
      ...getDefaultEnvironment(),
      BROWSER_USE_CONFIG_DIR: configDir,
      BROWSER_USE_CONFIG_PATH: path.join(configDir, 'config.json'),
      ANONYMIZED_TELEMETRY: 'false',
      BROWSER_USE_CLOUD_SYNC: 'false',
      BROWSER_USE_VERSION_CHECK: 'false',
      BROWSER_USE_DISABLE_EXTENSIONS: 'true',
    },
    stderr: 'pipe',
    maxBufferSize: 20 * 1024 * 1024,
  });
  let startupStderr = '';
  transport.stderr?.on('data', (chunk: Buffer | string) => {
    startupStderr = `${startupStderr}${String(chunk)}`.slice(-4_000);
  });
  const client = new Client({ name: 'yuheng', version: '0.1.3' }, { capabilities: {} });
  try {
    await client.connect(transport, { timeout: BROWSER_USE_START_TIMEOUT_MS, maxTotalTimeout: BROWSER_USE_START_TIMEOUT_MS });
  } catch (error) {
    await transport.close().catch(() => undefined);
    const detail = error instanceof Error ? error.message : String(error);
    const installFailed = /failed to (download|fetch)|operation timed out/i.test(startupStderr);
    const hint = installFailed
      ? '首次安装依赖失败，请检查网络后重试。'
      : '请确认已安装 uv，且当前网络可以完成首次运行时安装。';
    throw new Error(`无法启动 Browser Use ${BROWSER_USE_VERSION}。${hint}${detail ? ` ${detail}` : ''}`);
  }
  return {
    async callTool(name, args, signal) {
      const result = await client.callTool({ name, arguments: args }, undefined, { signal, timeout: 120_000, maxTotalTimeout: 300_000 });
      const rawContent: unknown[] = Array.isArray(result.content) ? result.content : [];
      const content = rawContent.flatMap((item): BrowserUseContent[] => {
        if (!item || typeof item !== 'object') return [];
        const block = item as Record<string, unknown>;
        if (block.type === 'text' && typeof block.text === 'string') return [{ type: 'text', text: block.text }];
        if (block.type === 'image' && typeof block.data === 'string' && typeof block.mimeType === 'string') return [{ type: 'image', data: block.data, mimeType: block.mimeType }];
        return [];
      });
      const textError = content.find((item) => item.type === 'text' && item.text.trim().startsWith('Error:'));
      return { content, isError: result.isError === true || Boolean(textError) };
    },
    async close() {
      await client.close();
    },
  };
}

export class BrowserUseSupervisor {
  private readonly dataDir: string;
  private readonly createClient: (dataDir: string) => Promise<BrowserUseClient>;
  private client: BrowserUseClient | undefined;
  private starting: Promise<BrowserUseClient> | undefined;
  private inFlight = 0;
  private closeWhenIdle = false;

  constructor(options: BrowserUseSupervisorOptions) {
    this.dataDir = options.dataDir;
    this.createClient = options.createClient ?? createMcpClient;
  }

  private async getClient(): Promise<BrowserUseClient> {
    if (this.client) return this.client;
    if (!this.starting) {
      this.starting = this.createClient(this.dataDir).then((client) => {
        this.client = client;
        return client;
      }).finally(() => {
        this.starting = undefined;
      });
    }
    return this.starting;
  }

  async callTool(name: BrowserToolName, args: Record<string, unknown>, signal?: AbortSignal): Promise<BrowserUseToolResult> {
    if (!BROWSER_TOOL_NAMES.includes(name)) throw new Error(`Browser Use tool is not allowed: ${name}`);
    if (signal?.aborted) throw new DOMException('Browser tool call cancelled.', 'AbortError');
    this.inFlight += 1;
    try {
      const client = await this.getClient();
      const result = await client.callTool(name, args, signal);
      if (result.isError) {
        const message = result.content.find((item) => item.type === 'text')?.text ?? `${name} failed.`;
        throw new Error(message);
      }
      return result;
    } finally {
      this.inFlight -= 1;
      if (this.closeWhenIdle && this.inFlight === 0) await this.closeClient();
    }
  }

  async disable(): Promise<void> {
    this.closeWhenIdle = true;
    if (this.inFlight === 0) await this.closeClient();
  }

  private async closeClient(): Promise<void> {
    const pending = this.starting;
    const client = this.client ?? (pending ? await pending.catch(() => undefined) : undefined);
    this.client = undefined;
    this.closeWhenIdle = false;
    if (client) await client.close();
  }

  async dispose(): Promise<void> {
    this.closeWhenIdle = true;
    await this.closeClient();
  }
}

export function redactBrowserToolInput(toolName: string, value: unknown): unknown {
  if (toolName !== 'browser_type' || !value || typeof value !== 'object') return value;
  const input = value as Record<string, unknown>;
  const text = typeof input.text === 'string' ? input.text : '';
  return { ...input, text: `<redacted:${text.length} characters>` };
}
