import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { AppStore } from '../electron/store';
import { createStorageStartup, mapStorageFailure, recordUnexpectedStartupFailure } from '../electron/app/storage-startup';

describe('storage startup integration', () => {
  it('passes the prepared owner to AppStore without transferring connection ownership', async () => {
    const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-startup-store-'));
    const stages: string[] = [];
    try {
      const result = await createStorageStartup(dataDirectory, '0.3.2').prepare((stage) => { stages.push(stage); });
      assert.equal(result.status, 'ready');
      if (result.status !== 'ready') return;

      const owner = result.database.value;
      const store = AppStore.fromPreparedDatabase(owner);
      assert.ok(store.listConversations().length > 0);
      store.close();
      assert.equal(Number(owner.database.prepare('SELECT 1 AS value').get()?.value), 1);
      await result.database.close();
      assert.deepEqual(stages, ['checking', 'snapshotting', 'migrating', 'verifying']);
    } finally {
      fs.rmSync(dataDirectory, { recursive: true, force: true });
    }
  });

  it('maps storage failures without exposing implementation errors', () => {
    assert.deepEqual(mapStorageFailure({
      code: 'migration_failed',
      stage: 'private-storage-stage',
      retryable: true,
      currentVersion: 1,
      targetVersion: 2,
      diagnosticId: 'diagnostic-1',
      userMessage: '数据准备失败，请重试或导出诊断。',
    }), {
      code: 'migration_failed',
      stage: 'checking',
      retryable: true,
      currentSchemaVersion: 1,
      targetSchemaVersion: 2,
      diagnosticId: 'diagnostic-1',
      userMessage: '数据准备失败，请重试或导出诊断。',
    });
  });

  it('persists a redacted diagnostic for non-database initialization failures', () => {
    const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-startup-diagnostic-'));
    try {
      const failure = recordUnexpectedStartupFailure(
        dataDirectory,
        '0.3.2',
        new Error('SQLite failed at /Users/private/data token=top-secret'),
        'initializing',
      );
      const reportPath = path.join(dataDirectory, 'recovery', 'diagnostics', `${failure.diagnosticId}.json`);
      const report = fs.readFileSync(reportPath, 'utf8');
      assert.doesNotMatch(report, /\/Users\/private|top-secret|SQLite failed/u);
      assert.match(report, /initialization_failed/u);
    } finally {
      fs.rmSync(dataDirectory, { recursive: true, force: true });
    }
  });
});
