import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { DatabaseOwner } from '../electron/storage/database';
import { createCanonicalBusinessSchema } from '../electron/storage/schema';
import { createStorageRepositories } from '../electron/storage/repositories';

describe('storage repositories', () => {
  it('shares the caller-owned database connection across narrow repositories', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-repositories-'));
    const owner = DatabaseOwner.open(path.join(dataDir, 'yuheng.sqlite'));
    try {
      createCanonicalBusinessSchema(owner.database);
      const repositories = createStorageRepositories(owner.database);
      repositories.providers.save({ protocol: 'openai', baseUrl: 'https://example.invalid/v1', model: 'fixture', displayName: 'Fixture', contextWindow: 4096 });
      assert.equal(repositories.providers.get()?.model, 'fixture');
      assert.equal(repositories.settings.set('browser_use', { enabled: true }).enabled, true);
      assert.deepEqual(repositories.settings.get('browser_use', { enabled: false }), { enabled: true });
      assert.deepEqual(repositories.conversations.list(), []);
      assert.deepEqual(repositories.tasks.list(), []);
      assert.deepEqual(repositories.notes.list(), []);
      assert.equal(repositories.search.hasFullTextIndex(), false);
    } finally {
      owner.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
