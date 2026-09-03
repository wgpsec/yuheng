import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { ComputerUseLease, diagnoseComputerUseEnvironment, openComputerUsePermissionPane, redactComputerUseToolInput } from '../electron/computer-use';

const require = createRequire(import.meta.url);

describe('Computer Use environment', () => {
  it('filters an invalid zero window id before calling the upstream macOS helper', () => {
    const backend = fs.readFileSync(require.resolve('@injaneity/pi-computer-use/src/platform/macos/backend.ts'), 'utf8');
    assert.match(backend, /\.\.\.\(request\.target\.windowId > 0 \? \{ windowId: request\.target\.windowId \} : \{\}\)/);
    assert.doesNotMatch(backend, /\n\s*windowId: request\.target\.windowId,/);
  });

  it('rejects unsupported platforms before looking for a helper', async () => {
    const result = await diagnoseComputerUseEnvironment({ platform: 'linux', arch: 'x64', fileExists: () => { throw new Error('must not inspect helper'); } });
    assert.equal(result.status, 'unavailable');
    assert.match(result.message, /仅支持 macOS/);
  });

  it('reports Intel Macs as unsupported by the arm64 package', async () => {
    const result = await diagnoseComputerUseEnvironment({ platform: 'darwin', arch: 'x64', exec: async () => ({ stdout: '14.6.1', stderr: '' }), fileExists: () => true });
    assert.equal(result.status, 'unavailable');
    assert.match(result.message, /Apple Silicon/);
  });

  it('reports an installed helper and reminds about macOS permissions', async () => {
    const result = await diagnoseComputerUseEnvironment({ platform: 'darwin', arch: 'arm64', homeDir: '/Users/test', exec: async () => ({ stdout: '14.6.1', stderr: '' }), fileExists: (filePath) => filePath === '/Users/test/Applications/pi-computer-use.app', accessibilityCheck: () => false, screenRecordingCheck: () => 'denied' });
    assert.equal(result.status, 'needs_permission');
    assert.equal(result.helperInstalled, true);
    assert.equal(result.permissions, 'required');
    assert.equal(result.accessibility, false);
    assert.equal(result.screenRecording, 'denied');
    assert.match(result.message, /辅助功能、屏幕录制/);
  });

  it('reports ready only when both macOS permissions are granted', async () => {
    const result = await diagnoseComputerUseEnvironment({ platform: 'darwin', arch: 'arm64', homeDir: '/Users/test', exec: async () => ({ stdout: '14.6.1', stderr: '' }), fileExists: () => true, accessibilityCheck: () => true, screenRecordingCheck: () => 'granted' });
    assert.equal(result.status, 'ready');
    assert.equal(result.permissions, 'granted');
    assert.match(result.message, /已就绪/);
  });

  it('opens the matching macOS privacy pane and requests accessibility permission', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    let prompted = false;
    await openComputerUsePermissionPane('accessibility', { platform: 'darwin', requestAccessibility: (prompt) => { prompted = prompt; return false; }, exec: async (command, args) => { calls.push({ command, args }); return { stdout: '', stderr: '' }; } });
    assert.equal(prompted, true);
    assert.deepEqual(calls, [{ command: 'open', args: ['x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'] }]);
    await openComputerUsePermissionPane('screenRecording', { platform: 'darwin', exec: async (command, args) => { calls.push({ command, args }); return { stdout: '', stderr: '' }; } });
    assert.deepEqual(calls[1], { command: 'open', args: ['x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'] });
  });
});

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
