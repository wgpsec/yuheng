import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SecretStore } from '../electron/secrets';

test('SecretStore persists portable provider keys without platform encryption', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-secrets-'));
  try {
    const store = new SecretStore(dataDir);
    store.saveProviderKeys({ default: 'sk-portable', secondary: 'key-2' });
    assert.equal(store.getProviderKey('default'), 'sk-portable');
    assert.equal(store.getProviderKey('secondary'), 'key-2');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'secrets.json'), 'utf8')), {
      version: 2,
      providerKeys: { default: 'sk-portable', secondary: 'key-2' },
    });
    assert.equal(fs.statSync(path.join(dataDir, 'secrets.json')).mode & 0o777, 0o600);
    store.deleteProviderKey('secondary');
    assert.equal(store.getProviderKey('secondary'), null);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
