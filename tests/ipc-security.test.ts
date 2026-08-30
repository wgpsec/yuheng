import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { IpcSenderAuthorizer } from '../electron/ipc-security';

describe('IPC sender authorization', () => {
  it('keeps main and pet renderer capabilities separate', () => {
    const authorizer = new IpcSenderAuthorizer();
    authorizer.register(10, 'main');
    authorizer.register(20, 'pet');

    assert.equal(authorizer.assertAllowed(10, ['main']), 'main');
    assert.equal(authorizer.assertAllowed(20, ['pet']), 'pet');
    assert.throws(() => authorizer.assertAllowed(20, ['main']), /not allowed/);
    assert.throws(() => authorizer.assertAllowed(99, ['main', 'pet']), /not registered/);
  });

  it('revokes a destroyed renderer identity', () => {
    const authorizer = new IpcSenderAuthorizer();
    authorizer.register(10, 'main');
    authorizer.unregister(10);
    assert.throws(() => authorizer.assertAllowed(10, ['main']), /not registered/);
  });

  it('registers secured IPC handlers through Electron exactly once', () => {
    const main = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');
    assert.match(main, /function handleForRoles[\s\S]*?ipcMain\.handle\(channel/);
    assert.doesNotMatch(main, /function handleForRoles[\s\S]*?handleMain\(channel/);
  });

  it('exposes permission settings only through main-renderer IPC handlers', () => {
    const main = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = readFileSync(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    assert.match(main, /handleMain\('permissions:get'/);
    assert.match(main, /handleMain\('permissions:save'/);
    assert.doesNotMatch(main, /ipcMain\.handle\('permissions:/);
    assert.match(preload, /permissions:\s*\{[\s\S]*?'permissions:get'[\s\S]*?'permissions:save'/);
    assert.match(main, /activeRuns\.set\([^\n]+permissionMode/);
    assert.match(main, /new ToolSecurityPolicy\(workspaceDir, run\.permissionMode\)/);
  });
});
