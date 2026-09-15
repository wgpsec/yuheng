import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { IpcSenderAuthorizer } from '../electron/ipc-security';
import { SecuredIpcRegistrar } from '../electron/ipc/secured-ipc-registrar';

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

  it('registers, authorizes, and disposes handlers exactly once', async () => {
    const handlers = new Map<string, (event: { sender: { id: number } }) => unknown>();
    const removed: string[] = [];
    const ipc = {
      handle: (channel: string, handler: (event: { sender: { id: number } }) => unknown) => { handlers.set(channel, handler); },
      removeHandler: (channel: string) => { removed.push(channel); handlers.delete(channel); },
      on: () => ipc,
      removeListener: () => ipc,
    } as unknown as ConstructorParameters<typeof SecuredIpcRegistrar>[0];
    const authorizer = new IpcSenderAuthorizer();
    authorizer.register(10, 'main');
    authorizer.register(20, 'pet');
    const registrar = new SecuredIpcRegistrar(ipc, authorizer);
    registrar.main('app:test', () => 'ok');

    assert.equal(await handlers.get('app:test')!({ sender: { id: 10 } }), 'ok');
    assert.throws(() => handlers.get('app:test')!({ sender: { id: 20 } }), /not allowed/);
    assert.throws(() => registrar.main('app:test', () => 'duplicate'), /already registered/);
    registrar.dispose();
    registrar.dispose();
    assert.deepEqual(removed, ['app:test']);
  });

  it('exposes permission settings only through main-renderer IPC handlers', () => {
    const runIpc = readFileSync(new URL('../electron/ipc/register-run-ipc.ts', import.meta.url), 'utf8');
    const main = readFileSync(new URL('../electron/app/normal-application.ts', import.meta.url), 'utf8');
    const executor = readFileSync(new URL('../electron/runs/run-executor.ts', import.meta.url), 'utf8');
    const preload = readFileSync(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    assert.match(runIpc, /registrar\.main\('permissions:get'/);
    assert.match(runIpc, /registrar\.main\('permissions:save'/);
    assert.doesNotMatch(runIpc, /mainAndPet\('permissions:/);
    assert.match(preload, /permissions:\s*\{[\s\S]*?'permissions:get'[\s\S]*?'permissions:save'/);
    assert.match(main, /runCoordinator\.start\([^\n]+permissionMode/);
    assert.match(executor, /new ToolSecurityPolicy\(preparedWorkspace\.projectDirectory, run\.permissionMode\)/);
  });

  it('exposes Finder attachment paths through the secured main-renderer bridge', () => {
    const runIpc = readFileSync(new URL('../electron/ipc/register-run-ipc.ts', import.meta.url), 'utf8');
    const main = readFileSync(new URL('../electron/app/normal-application.ts', import.meta.url), 'utf8');
    const preload = readFileSync(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    assert.match(runIpc, /registrar\.main\('attachments:add-paths'/);
    assert.match(main, /const addAttachments = async \(rawPaths: unknown\)/);
    assert.match(main, /if \(!path\.isAbsolute\(filePath\)\)/);
    assert.match(preload, /import \{ contextBridge, ipcRenderer, webUtils \} from 'electron'/);
    assert.match(preload, /addPaths: \(paths: string\[\]\) => ipcRenderer\.invoke\('attachments:add-paths', paths\)/);
    assert.match(preload, /pathForFile: \(file: File\) => webUtils\.getPathForFile\(file\)/);
  });

  it('limits Finder drop handling to the conversation workspace', () => {
    const renderer = readFileSync(new URL('../frontend/src/production/ProductionRenderer.tsx', import.meta.url), 'utf8');
    assert.match(renderer, /settingsMounted \|\| activeView !== 'conversation' \|\| !event\.dataTransfer\.types\.includes\('Files'\)/);
    assert.match(renderer, /onDrop=\{handleAttachmentDrop\}/);
    assert.match(renderer, /attachmentDropActive && activeView === 'conversation' && !settingsMounted/);
  });

  it('exposes knowledge-base operations through the secured notes bridge', () => {
    const ipc = readFileSync(new URL('../electron/ipc/register-note-ipc.ts', import.meta.url), 'utf8');
    const preload = readFileSync(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    for (const channel of ['knowledge-bases:list', 'knowledge-bases:active', 'knowledge-bases:set-active', 'knowledge-bases:create', 'knowledge-bases:update', 'knowledge-bases:delete', 'notes:list-in-knowledge-base', 'notes:create-in-knowledge-base', 'notes:move-to-knowledge-base', 'notes:copy-to-knowledge-base']) {
      assert.ok(ipc.includes(`registrar.main('${channel}'`), `missing IPC handler ${channel}`);
      assert.ok(preload.includes(`'${channel}'`), `missing preload channel ${channel}`);
    }
    assert.match(preload, /knowledgeBases:\s*\{/);
  });
});
