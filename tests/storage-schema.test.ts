import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { AppStore } from '../electron/store';
import { CANONICAL_INDEXES, validateCanonicalBusinessSchema } from '../electron/storage/schema';
import { inspectLegacyV1Schema } from '../electron/storage/schema';
import { createLegacyV1Fixture } from './fixtures/storage-v1';

describe('legacy v1 schema fixtures', () => {
  it('recognizes the initial Yuheng database without treating it as canonical', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-v1-initial-'));
    const databasePath = createLegacyV1Fixture(dataDir, 'initial');
    const db = new DatabaseSync(databasePath);
    try {
      const inspection = inspectLegacyV1Schema(db);
      assert.equal(inspection.recognized, true);
      assert.equal(inspection.variant, 'initial');
      assert.equal(inspection.canonical, false);
    } finally {
      db.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('classifies each historical schema variant and keeps its fixture rows readable', () => {
    const variants = ['provider-context', 'run-artifacts', 'task-board', 'notes', 'current'] as const;
    for (const variant of variants) {
      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `yuheng-v1-${variant}-`));
      const databasePath = createLegacyV1Fixture(dataDir, variant);
      const db = new DatabaseSync(databasePath);
      try {
        const inspection = inspectLegacyV1Schema(db);
        assert.equal(inspection.recognized, true, variant);
        assert.equal(inspection.variant, variant);
        assert.equal(db.prepare('SELECT title FROM conversations WHERE id = ?').get('fixture-conversation')?.title, '脱敏会话');
        if (variant === 'task-board' || variant === 'notes' || variant === 'current') {
          assert.equal(db.prepare('SELECT title FROM tasks WHERE id = ?').get('fixture-task')?.title, '脱敏任务');
        }
        if (variant === 'notes' || variant === 'current') {
          assert.equal(db.prepare('SELECT title FROM notes WHERE id = ?').get('fixture-note')?.title, '脱敏笔记');
        }
      } finally {
        db.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
      }
    }
  });
});

describe('canonical business schema', () => {
  it('pins the tables, columns, and indexes produced by the current AppStore', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-v1-current-'));
    const store = new AppStore(dataDir);
    store.close();
    const db = new DatabaseSync(path.join(dataDir, 'yuheng.sqlite'));
    try {
      const result = validateCanonicalBusinessSchema(db);
      assert.equal(result.ok, true, result.violations.join('\n'));
      assert.deepEqual(result.indexes, CANONICAL_INDEXES);
    } finally {
      db.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
