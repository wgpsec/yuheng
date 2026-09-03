import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { DatabaseOwner } from '../electron/storage/database';
import { MigrationRunner } from '../electron/storage/migration-runner';
import { migrations } from '../electron/storage/migrations';
import { createCanonicalBusinessSchema } from '../electron/storage/schema';
import { createStorageRepositories } from '../electron/storage/repositories';
import { createLegacyV1Fixture } from './fixtures/storage-v1';

describe('knowledge base repository', () => {
  it('creates a default knowledge base and isolates page trees by knowledge base', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-knowledge-base-'));
    const owner = DatabaseOwner.open(path.join(dataDir, 'yuheng.sqlite'));
    try {
      createCanonicalBusinessSchema(owner.database);
      const repositories = createStorageRepositories(owner);
      const fallback = repositories.knowledgeBases.getDefault();
      const operations = repositories.knowledgeBases.create({ name: '运维知识库', icon: '🛠️', color: '#4f8f8b' });
      const development = repositories.knowledgeBases.create({ name: '开发知识库' });
      const operationsRoot = repositories.notes.createInKnowledgeBase(operations.id, { title: '发布流程' });
      const rollback = repositories.notes.createInKnowledgeBase(operations.id, { title: '回滚流程', parentId: operationsRoot.id });
      const api = repositories.notes.createInKnowledgeBase(development.id, { title: 'API 规范' });

      assert.equal(fallback.name, '默认知识库');
      assert.equal(repositories.notes.listInKnowledgeBase(operations.id).length, 2);
      assert.equal(repositories.notes.listInKnowledgeBase(development.id).length, 1);
      assert.equal(repositories.notes.listInKnowledgeBase(fallback.id).length, 0);
      assert.equal(repositories.knowledgeBases.getActiveId(), null);
      assert.equal(repositories.knowledgeBases.setActiveId(development.id), development.id);
      assert.equal(createStorageRepositories(owner).knowledgeBases.getActiveId(), development.id);
      assert.throws(
        () => repositories.notes.createInKnowledgeBase(development.id, { title: '非法子页', parentId: operationsRoot.id }),
        /same knowledge base/i,
      );
      assert.throws(() => repositories.notes.move(operationsRoot.id, api.id), /same knowledge base/i);
      const moved = repositories.notes.moveToKnowledgeBase(operationsRoot.id, development.id);
      assert.equal(moved.id, operationsRoot.id);
      assert.equal(moved.knowledgeBaseId, development.id);
      assert.equal(repositories.notes.get(rollback.id)?.knowledgeBaseId, development.id);
      const copied = repositories.notes.copyToKnowledgeBase(operationsRoot.id, fallback.id);
      assert.notEqual(copied.id, operationsRoot.id);
      const copiedPages = repositories.notes.listInKnowledgeBase(fallback.id);
      assert.deepEqual(copiedPages.map((note) => note.title).sort(), ['发布流程', '回滚流程']);
      assert.equal(copiedPages.find((note) => note.title === '回滚流程')?.parentId, copied.id);
      repositories.knowledgeBases.setActiveId(development.id);
      repositories.knowledgeBases.delete(development.id);
      assert.equal(repositories.knowledgeBases.get(development.id), null);
      assert.equal(repositories.notes.listInKnowledgeBase(development.id, true).length, 0);
      assert.notEqual(repositories.knowledgeBases.getActiveId(), development.id);
      repositories.knowledgeBases.update(operations.id, { archived: true });
      assert.throws(() => repositories.knowledgeBases.setActiveId(operations.id), /not available/i);
    } finally {
      owner.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('adopts historical notes into the default knowledge base', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-knowledge-base-migration-'));
    const databasePath = createLegacyV1Fixture(dataDir, 'notes');
    const owner = DatabaseOwner.open(databasePath);
    try {
      const runner = new MigrationRunner(owner, migrations, { appVersion: '0.4.0' });
      runner.migrate({ id: 'legacy-notes', status: 'verified', sourceVersion: 1, targetVersion: migrations.length, sha256: 'fixture' });
      const knowledgeBase = owner.database.prepare("SELECT id, name FROM knowledge_bases WHERE name = '默认知识库'").get() as { id: string; name: string } | undefined;
      assert.ok(knowledgeBase);
      const note = owner.database.prepare('SELECT knowledge_base_id AS knowledgeBaseId FROM notes WHERE id = ?').get('fixture-note') as { knowledgeBaseId: string } | undefined;
      assert.equal(note?.knowledgeBaseId, knowledgeBase?.id);
    } finally {
      owner.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
