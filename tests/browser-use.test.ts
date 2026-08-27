import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { BrowserUseSupervisor, redactBrowserToolInput, type BrowserUseClient } from '../electron/browser-use';

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
