import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';
import { ComputerUseLease, computerUseActionOutcome, computerUseHelperPath, diagnoseComputerUseEnvironment, openComputerUsePermissionPane, redactComputerUseToolInput } from '../electron/computer-use';
import { ensurePermissions } from '@injaneity/pi-computer-use/src/permissions.ts';

const require = createRequire(import.meta.url);

describe('Computer Use environment', () => {
  it('uses the user helper location when no system helper is installed', () => {
    const helperPath = computerUseHelperPath('/Users/test', () => false, () => true);
    assert.equal(helperPath, '/Users/test/Applications/pi-computer-use.app');
  });

  it('uses the user helper location when the system helper directory is not writable', () => {
    const helperPath = computerUseHelperPath('/Users/test', (filePath) => filePath === '/Applications/pi-computer-use.app', () => false);
    assert.equal(helperPath, '/Users/test/Applications/pi-computer-use.app');
  });

  it('keeps a writable system helper location', () => {
    const helperPath = computerUseHelperPath('/Users/test', (filePath) => filePath === '/Applications/pi-computer-use.app', () => true);
    assert.equal(helperPath, '/Applications/pi-computer-use.app');
  });

  it('honors an explicit helper path override', () => {
    const previous = process.env.PI_COMPUTER_USE_HELPER_APP_PATH;
    process.env.PI_COMPUTER_USE_HELPER_APP_PATH = '/tmp/custom-pi-computer-use.app';
    try {
      assert.equal(computerUseHelperPath('/Users/test', () => true), '/tmp/custom-pi-computer-use.app');
    } finally {
      if (previous === undefined) delete process.env.PI_COMPUTER_USE_HELPER_APP_PATH;
      else process.env.PI_COMPUTER_USE_HELPER_APP_PATH = previous;
    }
  });

  it('preserves the resolved pid and filters an invalid zero window id before calling the macOS helper', () => {
    const backend = fs.readFileSync(require.resolve('@injaneity/pi-computer-use/src/platform/macos/backend.ts'), 'utf8');
    assert.match(backend, /request\.target\.pid/);
    assert.match(backend, /windowId: request\.target\.windowId/);
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
    assert.match(result.message, /单个窗口.*捕获/);
  });

  it('uses the helper live permission result instead of玉衡 process permissions', async () => {
    const result = await diagnoseComputerUseEnvironment({
      platform: 'darwin',
      arch: 'arm64',
      homeDir: '/Users/test',
      fileExists: (filePath) => filePath === '/Users/test/Applications/pi-computer-use.app',
      accessibilityCheck: () => true,
      screenRecordingCheck: () => 'granted',
      helperPermissionCheck: async () => ({
        accessibility: false,
        screenRecording: false,
        source: { attribution: 'helper-app', executablePath: '/Users/test/Applications/pi-computer-use.app/Contents/MacOS/bridge' },
      }),
    });
    assert.equal(result.status, 'needs_permission');
    assert.equal(result.accessibility, false);
    assert.equal(result.screenRecording, 'denied');
    assert.match(result.message, /辅助功能、屏幕录制/);
  });

  it('does not report ready when the live helper belongs to a different app bundle', async () => {
    const result = await diagnoseComputerUseEnvironment({
      platform: 'darwin',
      arch: 'arm64',
      homeDir: '/Users/test',
      fileExists: (filePath) => filePath === '/Users/test/Applications/pi-computer-use.app',
      helperPermissionCheck: async () => ({
        accessibility: true,
        screenRecording: true,
        source: { attribution: 'helper-app', executablePath: '/Applications/pi-computer-use.app/Contents/MacOS/bridge' },
      }),
    });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.permissions, 'unknown');
    assert.match(result.message, /来源不匹配/);
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
  it('reads only the structured act_ui outcome contract', () => {
    assert.deepEqual(computerUseActionOutcome('act_ui', {
      details: { actionOutcome: { status: 'not_dispatched', reason: 'visual_observation_unavailable', dispatchedActions: 0 } },
    }), { status: 'not_dispatched', reason: 'visual_observation_unavailable', dispatchedActions: 0 });
    assert.equal(computerUseActionOutcome('observe_ui', {
      details: { actionOutcome: { status: 'not_dispatched', reason: 'visual_observation_unavailable', dispatchedActions: 0 } },
    }), undefined);
    assert.equal(computerUseActionOutcome('act_ui', { content: [{ type: 'text', text: 'zero UI actions were executed' }] }), undefined);
  });

  it('stops retrying when visual capture is unavailable', () => {
    const skill = fs.readFileSync(path.join(process.cwd(), 'electron', 'skills', 'computer-use', 'SKILL.md'), 'utf8');
    assert.match(skill, /capture_unavailable/);
    assert.match(skill, /actionOutcome\.status/);
    assert.match(skill, /连续两次/);
    assert.match(skill, /停止/);
  });

  it('rechecks permissions after restarting the helper in a non-interactive Electron host', async () => {
    let checks = 0;
    let restarts = 0;
    const bridge = {
      kinds: [{ kind: 'accessibility' as const, openOption: 'Open Accessibility Settings' }],
      copy: {
        nonInteractiveError: () => 'permissions are still missing',
        prompt: () => 'grant permissions',
        incompleteError: () => 'incomplete',
        readyMessage: 'ready',
        stillMissing: () => 'missing',
      },
      checkPermissions: async () => ({ accessibility: checks++ > 0, screenRecording: true }),
      registerPermissions: async () => undefined,
      openPermissionPane: async () => undefined,
      restartHelper: async () => { restarts += 1; },
    };
    const status = await ensurePermissions({ hasUI: false } as never, bridge, '/tmp/pi-computer-use.app');
    assert.equal(status.accessibility, true);
    assert.equal(restarts, 1);
  });

  it('does not report a TTY requirement when non-interactive permissions remain missing', async () => {
    const bridge = {
      kinds: [{ kind: 'accessibility' as const, openOption: 'Open Accessibility Settings' }],
      copy: {
        nonInteractiveError: () => 'permissions are still missing',
        prompt: () => 'grant permissions',
        incompleteError: () => 'incomplete',
        readyMessage: 'ready',
        stillMissing: () => 'missing',
      },
      checkPermissions: async () => ({ accessibility: false, screenRecording: true }),
      registerPermissions: async () => undefined,
      openPermissionPane: async () => undefined,
      restartHelper: async () => undefined,
    };
    await assert.rejects(
      ensurePermissions({ hasUI: false } as never, bridge, '/tmp/pi-computer-use.app'),
      (error: unknown) => error instanceof Error && error.message === 'permissions are still missing',
    );
  });

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
