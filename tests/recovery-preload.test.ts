import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { RECOVERY_CHANNELS } from '../electron/recovery-channels';

const root = path.resolve(import.meta.dirname, '..');

test('recovery preload exposes only the fixed recovery invocation surface', () => {
  const source = fs.readFileSync(path.join(root, 'electron/recovery-preload.ts'), 'utf8');
  assert.match(source, /exposeInMainWorld\('recoveryBridge'/);
  assert.doesNotMatch(source, /exposeInMainWorld\('desktopBridge'/);
  assert.doesNotMatch(source, /ipcRenderer\.(?:send|sendSync|postMessage|on|once)\s*\(/);

  const invokedKeys = [...source.matchAll(/ipcRenderer\.invoke\(RECOVERY_CHANNELS\.([A-Za-z]+)/g)].map((match) => match[1]).sort();
  assert.deepEqual(invokedKeys, Object.keys(RECOVERY_CHANNELS).sort());
  assert.ok(Object.values(RECOVERY_CHANNELS).every((channel) => channel.startsWith('recovery:')));
});

test('recovery window uses an isolated sandbox and blocks renderer navigation', () => {
  const source = fs.readFileSync(path.join(root, 'electron/windows/recovery-window.ts'), 'utf8');
  assert.match(source, /contextIsolation:\s*true/);
  assert.match(source, /nodeIntegration:\s*false/);
  assert.match(source, /sandbox:\s*true/);
  assert.match(source, /will-navigate[\s\S]*preventDefault/);
  assert.match(source, /will-attach-webview[\s\S]*preventDefault/);
  assert.match(source, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.match(source, /query: \{ recovery: '1' \}/);
});
