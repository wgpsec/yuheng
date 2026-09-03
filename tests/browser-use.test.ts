import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { BrowserUseSupervisor, diagnoseBrowserUseEnvironment, browserUseCommandCandidates, redactBrowserToolInput, type BrowserUseClient } from '../electron/browser-use';

describe('Browser Use environment', () => {
  it('includes Finder-safe uvx locations and prefers the configured command', () => {
    assert.deepEqual(browserUseCommandCandidates({ YUHENG_BROWSER_USE_COMMAND: '/custom/uvx' }, '/Users/test'), ['/custom/uvx', '/Users/test/.local/bin/uvx', '/opt/homebrew/bin/uvx', '/usr/local/bin/uvx', 'uvx']);
  });

  it('reports a ready uvx without downloading Browser Use', async () => {
    const result = await diagnoseBrowserUseEnvironment({ homeDir: '/Users/test', exec: async (command) => {
      assert.equal(command, '/Users/test/.local/bin/uvx');
      return { stdout: 'uv 0.8.0\n', stderr: '' };
    } });
    assert.equal(result.status, 'ready');
    assert.equal(result.command, '/Users/test/.local/bin/uvx');
    assert.equal(result.version, 'uv 0.8.0');
  });

  it('reports a missing uvx and provides an explicit install command', async () => {
    const result = await diagnoseBrowserUseEnvironment({ exec: async () => { throw new Error('not found'); } });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.command, null);
    assert.match(result.installCommand, /astral\.sh\/uv\/install/);
  });
});

describe('BrowserUseSupervisor', () => {
  it('does not start a sidecar until an enabled plugin executes a tool', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-browser-use-'));
    let starts = 0;
    const client: BrowserUseClient = {
      async callTool() { return { content: [{ type: 'text', text: 'ok' }] }; },
      async close() {},
    };
    const supervisor = new BrowserUseSupervisor({ dataDir, createClient: async () => { starts += 1; return client; } });
    try {
      assert.equal(starts, 0);
      await supervisor.callTool('browser_get_state', {}, undefined);
      assert.equal(starts, 1);
      await supervisor.callTool('browser_list_tabs', {}, undefined);
      assert.equal(starts, 1);
    } finally {
      await supervisor.dispose();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('closes the sidecar when the plugin is disabled', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-browser-use-'));
    let closes = 0;
    const supervisor = new BrowserUseSupervisor({
      dataDir,
      createClient: async () => ({
        async callTool() { return { content: [{ type: 'text', text: 'ok' }] }; },
        async close() { closes += 1; },
      }),
    });
    try {
      await supervisor.callTool('browser_get_state', {}, undefined);
      await supervisor.disable();
      assert.equal(closes, 1);
    } finally {
      await supervisor.dispose();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('waits for a concurrently starting tool call before closing the sidecar', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-browser-use-'));
    let releaseStart: (() => void) | undefined;
    let calls = 0;
    let closes = 0;
    const starting = new Promise<void>((resolve) => { releaseStart = resolve; });
    const supervisor = new BrowserUseSupervisor({
      dataDir,
      createClient: async () => {
        await starting;
        return {
          async callTool() { calls += 1; return { content: [{ type: 'text', text: 'ok' }] }; },
          async close() { closes += 1; },
        };
      },
    });
    try {
      const call = supervisor.callTool('browser_get_state', {}, undefined);
      await supervisor.disable();
      assert.equal(closes, 0);
      releaseStart?.();
      await call;
      assert.equal(calls, 1);
      assert.equal(closes, 1);
    } finally {
      releaseStart?.();
      await supervisor.dispose();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('Browser Use privacy', () => {
  it('redacts typed text before it reaches persisted activity or approval summaries', () => {
    assert.deepEqual(redactBrowserToolInput('browser_type', { index: 7, text: 'secret@example.com' }), { index: 7, text: '<redacted:18 characters>' });
    assert.deepEqual(redactBrowserToolInput('browser_navigate', { url: 'https://example.com' }), { url: 'https://example.com' });
  });
});
