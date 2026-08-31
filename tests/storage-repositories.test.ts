import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { AppStore } from '../electron/store';
import { DatabaseOwner } from '../electron/storage/database';
import { createCanonicalBusinessSchema } from '../electron/storage/schema';
import { createStorageRepositories, type StorageRepositories } from '../electron/storage/repositories';

type RepositoryHarness = {
  dataDir: string;
  owner: DatabaseOwner;
  repositories: StorageRepositories;
};

function createRepositoryHarness(): RepositoryHarness {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-repositories-'));
  const owner = DatabaseOwner.open(path.join(dataDir, 'yuheng.sqlite'));
  createCanonicalBusinessSchema(owner.database);
  return { dataDir, owner, repositories: createStorageRepositories(owner) };
}

function closeRepositoryHarness(harness: RepositoryHarness): void {
  harness.owner.close();
  fs.rmSync(harness.dataDir, { recursive: true, force: true });
}

function rowCount(owner: DatabaseOwner, table: string): number {
  return Number((owner.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

describe('storage repository domain behavior', () => {
  it('keeps conversation projects, automatic titles, branches, and moves behind one repository', () => {
    const harness = createRepositoryHarness();
    try {
      const sourceProject = harness.repositories.conversations.createProject('研究');
      const targetProject = harness.repositories.conversations.createProject('交付');
      const conversation = harness.repositories.conversations.create('新会话', sourceProject.id);
      const first = harness.repositories.conversations.addMessage(conversation.id, 'user', '梳理本周需要交付的三个关键事项');
      const second = harness.repositories.conversations.addMessage(conversation.id, 'assistant', '先确认范围，再按风险排序。');
      harness.repositories.conversations.addMessage(conversation.id, 'user', '继续');

      assert.equal(harness.repositories.conversations.require(conversation.id).title, '梳理本周需要交付的三个关键事项');
      const branch = harness.repositories.conversations.branch(conversation.id, second.id);
      assert.deepEqual(harness.repositories.conversations.listMessages(branch.id).map(({ role, content }) => [role, content]), [
        ['user', first.content],
        ['assistant', second.content],
      ]);
      assert.equal(branch.projectId, sourceProject.id);
      assert.equal(harness.repositories.conversations.move(conversation.id, targetProject.id).projectId, targetProject.id);
    } finally {
      closeRepositoryHarness(harness);
    }
  });

  it('owns run, activity, artifact, usage, and terminal state behavior', () => {
    const harness = createRepositoryHarness();
    try {
      const conversation = harness.repositories.conversations.create();
      const message = harness.repositories.conversations.addMessage(conversation.id, 'user', '采集页面');
      harness.repositories.runs.start('run-domain', conversation.id, message.id);
      harness.repositories.runs.startActivity('run-domain', 'browser-1', 'navigate_browser', '{"url":"https://example.com"}');
      harness.repositories.runs.addArtifact('run-domain', 'browser-1', {
        id: 'artifact-domain',
        kind: 'browser_screenshot',
        mimeType: 'image/png',
        size: 128,
        url: 'yuheng-browser-artifact://local/artifact-domain.png',
      });
      assert.equal(harness.repositories.runs.finish('run-domain', 'completed', undefined, {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        contextTokens: 100,
        contextWindow: 4096,
        contextPercent: 2.4,
      }), true);

      const [run] = harness.repositories.runs.list(conversation.id);
      assert.equal(run.status, 'completed');
      assert.deepEqual(run.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15, contextTokens: 100, contextWindow: 4096, contextPercent: 2.4 });
      assert.equal(run.activities[0]?.status, 'completed');
      assert.deepEqual(run.activities[0]?.artifacts.map(({ id }) => id), ['artifact-domain']);
      assert.equal(harness.repositories.runs.finish('run-domain', 'failed'), false);
    } finally {
      closeRepositoryHarness(harness);
    }
  });

  it('keeps provider assignment and mutually exclusive runtime settings in narrow repositories', () => {
    const harness = createRepositoryHarness();
    try {
      const conversation = harness.repositories.conversations.create();
      const provider = harness.repositories.providers.save({
        protocol: 'openai',
        baseUrl: 'https://example.invalid/v1',
        model: 'fixture-model',
        displayName: 'Fixture Provider',
        contextWindow: 8192,
      });

      assert.equal(provider.id, 'default');
      assert.equal(harness.repositories.conversations.providerId(conversation.id), provider.id);
      assert.deepEqual(harness.repositories.settings.saveComputerUse({ enabled: true }), { enabled: true });
      assert.deepEqual(harness.repositories.settings.saveBrowserUse({ enabled: true }), { enabled: true });
      assert.deepEqual(harness.repositories.settings.getComputerUse(), { enabled: false });
    } finally {
      closeRepositoryHarness(harness);
    }
  });

  it('moves and copies tasks across boards using the target board first column', () => {
    const harness = createRepositoryHarness();
    try {
      const targetBoard = harness.repositories.tasks.createBoard('发布');
      const original = harness.repositories.tasks.create({ title: '核对安装包', description: '验证签名', priority: 'high' });

      const moved = harness.repositories.tasks.moveToBoard(original.id, targetBoard.id);
      const copied = harness.repositories.tasks.copyToBoard(moved.id, 'default');

      assert.equal(moved.status, harness.repositories.tasks.listTypes(targetBoard.id)[0]?.id);
      assert.equal(copied.status, harness.repositories.tasks.listTypes('default')[0]?.id);
      assert.notEqual(copied.id, moved.id);
      assert.deepEqual([copied.title, copied.description, copied.priority], [moved.title, moved.description, moved.priority]);
      assert.deepEqual(harness.repositories.tasks.list(targetBoard.id).map(({ id }) => id), [moved.id]);
      assert.deepEqual(harness.repositories.tasks.list('default').map(({ id }) => id), [copied.id]);
    } finally {
      closeRepositoryHarness(harness);
    }
  });

  it('maintains note trees, history restoration, block moves, and sibling order', () => {
    const harness = createRepositoryHarness();
    try {
      const root = harness.repositories.notes.create({ title: '项目', content: '根页面' });
      const child = harness.repositories.notes.create({ title: '方案', content: '第一版', parentId: root.id });
      const target = harness.repositories.notes.create({ title: '归档', content: '已有内容' });
      harness.repositories.notes.update(child.id, { content: '第二版' });
      const version = harness.repositories.notes.listVersions(child.id)[0]!;

      assert.equal(harness.repositories.notes.restoreVersion(child.id, version.id).content, '第一版');
      const movedBlock = harness.repositories.notes.moveBlock(child.id, target.id, '', '第一版');
      assert.equal(movedBlock.source.content, '');
      assert.equal(movedBlock.target.content, '已有内容\n\n第一版');
      assert.equal(harness.repositories.notes.move(child.id, null, target.id).parentId, null);
      assert.deepEqual(harness.repositories.notes.list().filter(({ parentId }) => parentId === null).map(({ title }) => title), ['项目', '方案', '归档']);
    } finally {
      closeRepositoryHarness(harness);
    }
  });

  it('projects conversations, tasks, and notes into one search repository', () => {
    const harness = createRepositoryHarness();
    try {
      harness.repositories.search.initialize();
      harness.repositories.conversations.create('统一投影发布会话');
      harness.repositories.tasks.create({ title: '统一投影发布任务' });
      harness.repositories.notes.create({ title: '统一投影发布笔记' });

      const results = harness.repositories.search.search('统一投影发布', 20);
      assert.deepEqual(new Set(results.map(({ kind }) => kind)), new Set(['conversation', 'task', 'note']));
    } finally {
      closeRepositoryHarness(harness);
    }
  });

  it('exports and imports a complete logical backup through one repository', () => {
    const source = createRepositoryHarness();
    const target = createRepositoryHarness();
    try {
      const conversation = source.repositories.conversations.create('备份领域验证');
      source.repositories.conversations.addMessage(conversation.id, 'user', '保留这条消息');
      source.repositories.tasks.create({ title: '保留这项任务' });
      source.repositories.notes.create({ title: '保留这篇笔记', content: '笔记正文' });

      const snapshot = source.repositories.backups.export();
      const report = target.repositories.backups.import(snapshot);

      assert.equal(report.conversations, snapshot.conversations.length);
      assert.equal(report.messages, snapshot.messages.length);
      assert.equal(report.tasks, snapshot.tasks.length);
      assert.equal(report.notes, snapshot.notes?.length);
      const imported = target.repositories.conversations.list(true).find(({ title }) => title === '备份领域验证');
      assert.ok(imported);
      assert.deepEqual(target.repositories.conversations.listMessages(imported.id).map(({ content }) => content), ['保留这条消息']);
      assert.equal(target.repositories.notes.list(true).some(({ title }) => title === '保留这篇笔记'), true);
    } finally {
      closeRepositoryHarness(source);
      closeRepositoryHarness(target);
    }
  });
});

describe('storage repository transaction boundaries', () => {
  it('rolls back run and activity state when terminal activity cleanup fails', () => {
    const harness = createRepositoryHarness();
    try {
      const conversation = harness.repositories.conversations.create();
      const message = harness.repositories.conversations.addMessage(conversation.id, 'user', '执行事务测试');
      harness.repositories.runs.start('run-rollback', conversation.id, message.id);
      harness.repositories.runs.startActivity('run-rollback', 'tool-rollback', 'bash');
      harness.owner.database.exec(`
        CREATE TRIGGER fail_run_activity_finish BEFORE UPDATE OF status ON run_activities
        WHEN NEW.status = 'completed'
        BEGIN SELECT RAISE(ABORT, 'forced activity failure'); END;
      `);

      assert.throws(() => harness.repositories.runs.finish('run-rollback', 'completed'), /forced activity failure/);
      const [run] = harness.repositories.runs.list(conversation.id);
      assert.equal(run.status, 'running');
      assert.equal(run.finishedAt, null);
      assert.equal(run.activities[0]?.status, 'running');
      assert.equal(run.activities[0]?.finishedAt, null);
    } finally {
      closeRepositoryHarness(harness);
    }
  });

  it('rolls back every imported entity when backup import fails after conversation insertion', () => {
    const source = createRepositoryHarness();
    const target = createRepositoryHarness();
    try {
      const conversation = source.repositories.conversations.create('失败导入');
      source.repositories.conversations.addMessage(conversation.id, 'user', 'FORCED_BACKUP_FAILURE');
      source.repositories.tasks.create({ title: '不应留下的任务' });
      source.repositories.notes.create({ title: '不应留下的笔记' });
      const snapshot = source.repositories.backups.export();
      const tables = ['conversation_projects', 'conversations', 'messages', 'task_boards', 'task_types', 'tasks', 'notes'] as const;
      const before = Object.fromEntries(tables.map((table) => [table, rowCount(target.owner, table)]));
      target.owner.database.exec(`
        CREATE TRIGGER fail_backup_message_insert BEFORE INSERT ON messages
        WHEN NEW.content = 'FORCED_BACKUP_FAILURE'
        BEGIN SELECT RAISE(ABORT, 'forced backup failure'); END;
      `);

      assert.throws(() => target.repositories.backups.import(snapshot), /forced backup failure/);
      assert.deepEqual(Object.fromEntries(tables.map((table) => [table, rowCount(target.owner, table)])), before);
    } finally {
      closeRepositoryHarness(source);
      closeRepositoryHarness(target);
    }
  });

  it('uses one owner transaction to roll back changes across repositories', () => {
    const harness = createRepositoryHarness();
    try {
      assert.throws(() => harness.owner.transaction(() => {
        harness.repositories.conversations.createProject('不应保留的项目');
        harness.repositories.tasks.createBoard('不应保留的看板');
        harness.repositories.notes.create('不应保留的笔记');
        throw new Error('abort cross-domain transaction');
      }), /abort cross-domain transaction/);

      assert.equal(harness.repositories.conversations.listProjects().some(({ name }) => name === '不应保留的项目'), false);
      assert.equal(harness.repositories.tasks.listBoards().some(({ name }) => name === '不应保留的看板'), false);
      assert.equal(harness.repositories.notes.list(true).some(({ title }) => title === '不应保留的笔记'), false);
    } finally {
      closeRepositoryHarness(harness);
    }
  });
});

describe('AppStore database ownership', () => {
  it('shares a prepared owner with repositories without taking its close ownership', () => {
    const harness = createRepositoryHarness();
    const store = AppStore.fromPreparedDatabase(harness.owner);
    try {
      const conversation = store.createConversation('门面写入');
      assert.equal(harness.repositories.conversations.require(conversation.id).title, '门面写入');
      const note = harness.repositories.notes.create('Repository 写入');
      assert.equal(store.getNote(note.id)?.title, 'Repository 写入');

      store.close();
      assert.equal(Number(harness.owner.database.prepare('SELECT 1 AS value').get()?.value), 1);
      harness.owner.close();
      assert.throws(() => store.listConversations(), /closed|not open/i);
      assert.throws(() => harness.repositories.tasks.listBoards(), /closed|not open/i);
    } finally {
      store.close();
      closeRepositoryHarness(harness);
    }
  });

  it('does not create or repair schema on the prepared production path', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-prepared-schema-'));
    const owner = DatabaseOwner.open(path.join(dataDir, 'yuheng.sqlite'));
    try {
      assert.throws(() => AppStore.fromPreparedDatabase(owner), /no such table: conversations/);
      assert.equal(owner.database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'conversations'").get(), undefined);
    } finally {
      owner.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
