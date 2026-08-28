import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { applicationVersion } from '../electron/app-info.ts';

test('reads the application version from its manifest instead of Electron runtime metadata', () => {
  const appRoot = mkdtempSync(path.join(tmpdir(), 'yuheng-app-info-'));
  try {
    writeFileSync(path.join(appRoot, 'package.json'), JSON.stringify({ name: 'yuheng', version: '9.4.2' }));
    assert.equal(applicationVersion(appRoot), '9.4.2');
  } finally {
    rmSync(appRoot, { recursive: true, force: true });
  }
});
