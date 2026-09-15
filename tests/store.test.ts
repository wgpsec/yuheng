import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { AppStore, DEFAULT_PROVIDER_CONTEXT_WINDOW } from '../electron/store';
import { TaskAssetStore } from '../electron/task-assets';

describe('AppStore run activities', () => {
  it('persists tool activity and closes it with the run lifecycle', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-'));
    let store = new AppStore(dataDir);
    try {
      const conversation = store.createConversation();
      const message = store.addMessage(conversation.id, 'user', '查看当前 IP');
      store.startRun('run-1', conversation.id, message.id);
      store.startToolActivity('run-1', 'tool-1', 'bash', '{"command":"curl ifconfig.me"}');
      store.finishToolActivity('run-1', 'tool-1', 'bash', false, '203.0.113.10');
      store.addRunArtifact('run-1', 'tool-1', {
        id: 'artifact-1',
        kind: 'browser_screenshot',
        mimeType: 'image/png',
        size: 1024,
        url: 'yuheng-browser-artifact://local/artifact-1.png',
      });
      store.finishRun('run-1', 'completed');
      assert.equal(store.finishRun('run-1', 'failed', '迟到的失败'), false);
      store.close();
      store = new AppStore(dataDir);

      const [run] = store.listRuns(conversation.id);
      assert.equal(run.status, 'completed');
      assert.equal(run.activities.length, 1);
      assert.deepEqual(run.activities[0], {
        id: 'tool-1',
        toolName: 'bash',
        status: 'completed',
        input: '{"command":"curl ifconfig.me"}',
        output: '203.0.113.10',
        startedAt: run.activities[0].startedAt,
        finishedAt: run.activities[0].finishedAt,
        artifacts: [{
          id: 'artifact-1',
          kind: 'browser_screenshot',
          mimeType: 'image/png',
          size: 1024,
          url: 'yuheng-browser-artifact://local/artifact-1.png',
        }],
      });
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('marks an in-flight tool activity cancelled during recovery', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-'));
    const store = new AppStore(dataDir);
    try {
      const conversation = store.createConversation();
      const message = store.addMessage(conversation.id, 'user', '执行诊断');
      store.startRun('run-2', conversation.id, message.id);
      store.startToolActivity('run-2', 'tool-2', 'read');
      store.recoverRunningRuns();

      const [run] = store.listRuns(conversation.id);
      assert.equal(run.status, 'interrupted');
      assert.equal(run.activities[0].status, 'cancelled');
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('persists provider usage and replaces the visible branch from a user message', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-'));
    const store = new AppStore(dataDir);
    try {
      const conversation = store.createConversation();
      const first = store.addMessage(conversation.id, 'user', '第一问');
      store.startRun('run-1', conversation.id, first.id);
      store.addMessage(conversation.id, 'assistant', '第一答');
      store.finishRun('run-1', 'completed', undefined, { inputTokens: 120, outputTokens: 30, totalTokens: 150, contextTokens: 900, contextWindow: 128000, contextPercent: 0.7 });
      const second = store.addMessage(conversation.id, 'user', '第二问');
      store.startRun('run-2', conversation.id, second.id);
      store.addMessage(conversation.id, 'assistant', '旧的第二答');
      store.finishRun('run-2', 'completed');

      const replacement = store.replaceFromUserMessage(conversation.id, second.id, '修改后的第二问');

      assert.deepEqual(store.listMessages(conversation.id).map(({ role, content }) => [role, content]), [
        ['user', '第一问'], ['assistant', '第一答'], ['user', '修改后的第二问'],
      ]);
      assert.equal(store.listRuns(conversation.id).some((run) => run.id === 'run-2'), false);
      assert.deepEqual(store.listRuns(conversation.id).find((run) => run.id === 'run-1')?.usage, { inputTokens: 120, outputTokens: 30, totalTokens: 150, contextTokens: 900, contextWindow: 128000, contextPercent: 0.7 });
      assert.equal(replacement.role, 'user');
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('AppStore schema marker', () => {
  it('records the current schema version without changing business tables', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-schema-'));
    const store = new AppStore(dataDir);
    try {
      const database = new DatabaseSync(path.join(dataDir, 'yuheng.sqlite'));
      try { assert.equal(Number((database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version), 1); }
      finally { database.close(); }
    } finally { store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
  });
});

describe('AppStore full backup snapshot', () => {
  it('exports and merges a snapshot with fresh identities and terminal runs', () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-source-'));
    const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-target-'));
    const source = new AppStore(sourceDir);
    const target = new AppStore(targetDir);
    try {
      const conversation = source.createConversation();
      const message = source.addMessage(conversation.id, 'user', '备份测试');
      source.startRun('r1', conversation.id, message.id);
      const snapshot = source.exportFullBackupSnapshot();
      const targetBefore = target.listConversations(true).length;
      const report = target.importFullBackupSnapshot(snapshot);
      assert.equal(report.conversations, snapshot.conversations.length);
      assert.equal(report.messages, snapshot.messages.length);
      assert.equal(target.listConversations(true).length, targetBefore + snapshot.conversations.length);
      const imported = target.listConversations(true).find((item) => item.title === '备份测试');
      assert.ok(imported);
      assert.equal(target.listMessages(imported!.id).length, 1);
      assert.equal(target.listRuns(imported!.id)[0].status, 'interrupted');
      assert.notEqual(imported!.id, conversation.id);
    } finally { source.close(); target.close(); fs.rmSync(sourceDir, { recursive: true, force: true }); fs.rmSync(targetDir, { recursive: true, force: true }); }
  });
});

describe('AppStore desktop presence settings', () => {
  it('defaults to enabled and persists notification/menu bar choices', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-presence-'));
    const store = new AppStore(dataDir);
    try {
      assert.deepEqual(store.getDesktopPresenceConfig('/tmp'), { notificationsEnabled: true, menuBarEnabled: true });
      assert.deepEqual(store.saveDesktopPresenceConfig({ notificationsEnabled: false, menuBarEnabled: false }), { notificationsEnabled: false, menuBarEnabled: false });
      assert.deepEqual(store.getDesktopPresenceConfig('/tmp'), { notificationsEnabled: false, menuBarEnabled: false });
    } finally { store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
  });
});

describe('AppStore desktop pet settings', () => {
  it('defaults disabled and persists the opt-in flag across store instances', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-pet-'));
    let store = new AppStore(dataDir);
    try {
      assert.deepEqual(store.getDesktopPetConfig(), { enabled: false });
      assert.deepEqual(store.saveDesktopPetConfig({ enabled: true }), { enabled: true });
      store.close();
      store = new AppStore(dataDir);
      assert.deepEqual(store.getDesktopPetConfig(), { enabled: true });
    } finally { store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
  });

  it('persists selected skin and clamps the display scale', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-pet-scale-'));
    const store = new AppStore(dataDir);
    try {
      assert.deepEqual(store.saveDesktopPetConfig({ enabled: true, petId: 'guga', scale: 2 }), { enabled: true, petId: 'guga', scale: 1.4 });
      assert.deepEqual(store.getDesktopPetConfig(), { enabled: true, petId: 'guga', scale: 1.4 });
    } finally { store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
  });

  it('persists pet controls and clamps opacity to a visible range', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-pet-controls-'));
    const store = new AppStore(dataDir);
    try {
      assert.deepEqual(store.saveDesktopPetConfig({ enabled: true, locked: true, opacity: 0.05, alwaysOnTop: false, edgeSnap: true, inertia: true, boundaryBounce: true }), {
        enabled: true,
        locked: true,
        opacity: 0.2,
        alwaysOnTop: false,
        edgeSnap: true,
        inertia: true,
        boundaryBounce: true,
      });
      store.close();
      const reopened = new AppStore(dataDir);
      assert.deepEqual(reopened.getDesktopPetConfig(), {
        enabled: true,
        locked: true,
        opacity: 0.2,
        alwaysOnTop: false,
        edgeSnap: true,
        inertia: true,
        boundaryBounce: true,
      });
      reopened.close();
    } finally {
      try { store.close(); } catch { /* already closed */ }
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('persists desktop pet feedback preferences across store instances', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-pet-feedback-'));
    let store = new AppStore(dataDir);
    try {
      const expected = {
        enabled: true,
        feedbackMode: 'important' as const,
        completionFeedback: false,
        errorFeedback: true,
        approvalFeedback: false,
        soundEnabled: true,
        mutedUntil: 2_000_000_000_000,
      };
      assert.deepEqual(store.saveDesktopPetConfig(expected), expected);
      store.close();
      store = new AppStore(dataDir);
      assert.deepEqual(store.getDesktopPetConfig(), expected);
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('AppStore provider settings', () => {
  it('stores multiple providers and binds each conversation to its selected provider', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-'));
    const store = new AppStore(dataDir);
    try {
      const first = store.saveProvider({ protocol: 'openai', baseUrl: 'https://one.example/v1', model: 'one', displayName: '一个模型', contextWindow: 200_000 });
      const second = store.saveProvider({ protocol: 'anthropic', baseUrl: 'https://two.example/v1', model: 'two', displayName: '另一个模型', contextWindow: 300_000 });
      assert.equal(first.supportsImages, false);
      assert.equal(second.supportsImages, false);
      assert.equal(store.listProviders().length, 2);
      // Editing a secondary profile must not silently change the default route for new conversations.
      store.saveProvider({ id: second.id, protocol: 'anthropic', baseUrl: 'https://two.example/v2', model: 'two-v2', displayName: '另一个模型（更新）', contextWindow: 300_000 });
      assert.equal(store.defaultProviderId(), first.id);
      assert.equal(store.createConversation('默认路由').providerId, first.id);
      const conversation = store.createConversation('绑定测试', undefined, second.id);
      assert.equal(conversation.providerId, second.id);
      assert.equal(store.getConversationProviderId(conversation.id), second.id);
      store.setConversationProvider(conversation.id, first.id);
      assert.equal(store.getConversation(conversation.id).providerId, first.id);
      store.setDefaultProviderId(second.id);
      assert.equal(store.defaultProviderId(), second.id);
      assert.equal(store.createConversation('显式默认路由').providerId, second.id);
      assert.throws(() => store.deleteProvider(second.id), /先选择其他默认 Provider/);
      assert.throws(() => store.setDefaultProviderId('missing-provider'), /Provider not found/);
      store.close();
      const reopened = new AppStore(dataDir);
      try {
        assert.equal(reopened.defaultProviderId(), second.id);
        assert.equal(reopened.createConversation('重启后默认路由').providerId, second.id);
      } finally {
        reopened.close();
      }
    } finally {
      try { store.close(); } catch { /* already closed after the persistence check */ }
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('migrates legacy providers to the default context window and persists a custom value', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-'));
    const database = new DatabaseSync(path.join(dataDir, 'yuheng.sqlite'));
    database.exec('CREATE TABLE provider_profiles (id INTEGER PRIMARY KEY CHECK (id = 1), protocol TEXT NOT NULL, base_url TEXT NOT NULL, model TEXT NOT NULL, display_name TEXT NOT NULL, updated_at TEXT NOT NULL)');
    database.prepare('INSERT INTO provider_profiles (id, protocol, base_url, model, display_name, updated_at) VALUES (1, ?, ?, ?, ?, ?)')
      .run('openai', 'https://api.example.test/v1', 'test-model', '测试模型', '2026-08-28T00:00:00.000Z');
    database.close();

    let store = new AppStore(dataDir);
    try {
      assert.equal(store.getProvider()?.contextWindow, DEFAULT_PROVIDER_CONTEXT_WINDOW);
      assert.equal(store.getProvider()?.supportsImages, false);
      store.saveProvider({ id: 'default', protocol: 'openai', baseUrl: 'https://api.example.test/v1', model: 'test-model', displayName: '测试模型', contextWindow: 320_000 });
      store.close();
      store = new AppStore(dataDir);
      assert.equal(store.getProvider()?.contextWindow, 320_000);
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('AppStore conversations', () => {
  it('supports an independent workspace override with project inheritance', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-'));
    const store = new AppStore(dataDir);
    try {
      const project = store.createConversationProject('项目', '/tmp/project-workspace');
      const inherited = store.createConversation('继承项目目录', project.id);
      const override = store.createConversation('独立目录', project.id);
      assert.equal(store.getConversationWorkspace(inherited.id), '/tmp/project-workspace');
      assert.equal(store.getConversationWorkspaceOverride(inherited.id), null);
      store.setConversationWorkspace(override.id, '/tmp/conversation-workspace');
      assert.equal(store.getConversationWorkspace(override.id), '/tmp/conversation-workspace');
      assert.equal(store.getConversation(inherited.id).workspacePath, undefined);
      assert.equal(store.getConversation(override.id).workspacePath, '/tmp/conversation-workspace');

      const movedOverride = store.moveConversation(override.id, 'personal');
      assert.equal(movedOverride.workspacePath, '/tmp/conversation-workspace');
      store.setConversationWorkspace(override.id, null);
      assert.equal(store.getConversationWorkspace(override.id), null);

      const message = store.addMessage(inherited.id, 'user', '创建分支');
      const branch = store.branchConversation(inherited.id, message.id);
      assert.equal(branch.workspacePath, undefined);
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('persists an independent agent profile per conversation', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-'));
    let store = new AppStore(dataDir);
    try {
      const assistant = store.createConversation('助手会话');
      const analyst = store.createConversation('分析会话', undefined, undefined, 'analyst');
      assert.equal(assistant.profileId, 'assistant');
      assert.equal(analyst.profileId, 'analyst');
      store.setConversationProfile(assistant.id, 'auditor');
      assert.equal(store.getConversationProfile(assistant.id), 'auditor');
      assert.equal(store.getConversationProfile(analyst.id), 'analyst');
      store.close();
      store = new AppStore(dataDir);
      assert.equal(store.getConversation(assistant.id).profileId, 'auditor');
      assert.equal(store.getConversation(analyst.id).profileId, 'analyst');
      assert.throws(() => store.setConversationProfile(assistant.id, 'unknown' as never), /Profile not found/);
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('migrates existing conversations to the unarchived default', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-'));
    const database = new DatabaseSync(path.join(dataDir, 'yuheng.sqlite'));
    try {
      database.exec("CREATE TABLE conversation_projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
      database.prepare('INSERT INTO conversation_projects (id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('personal', '个人事务', 0, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
      database.exec("CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
      database.prepare('INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run('legacy', '历史会话', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
    } finally {
      database.close();
    }

    const store = new AppStore(dataDir);
    try {
      assert.deepEqual(store.listConversations(), [{ id: 'legacy', projectId: 'personal', title: '历史会话', updatedAt: '2026-08-01T00:00:00.000Z', archived: false, pinned: false, profileId: 'assistant' }]);
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('renames, archives, restores, and deletes a conversation with its dependent records', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-'));
    const store = new AppStore(dataDir);
    try {
      const conversation = store.createConversation('发布讨论');
      const message = store.addMessage(conversation.id, 'user', '确认上线时间');
      store.startRun('conversation-run', conversation.id, message.id);
      store.finishRun('conversation-run', 'completed');

      assert.equal(store.renameConversation(conversation.id, '  发布复盘  ').title, '发布复盘');
      assert.equal(store.setConversationArchived(conversation.id, true).archived, true);
      assert.equal(store.listConversations().some((item) => item.id === conversation.id), false);
      assert.equal(store.listConversations(true).find((item) => item.id === conversation.id)?.archived, true);

      store.setConversationArchived(conversation.id, false);
      store.deleteConversation(conversation.id);
      assert.equal(store.listConversations(true).some((item) => item.id === conversation.id), false);
      assert.deepEqual(store.listMessages(conversation.id), []);
      assert.deepEqual(store.listRuns(conversation.id), []);
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('derives a short title from the first user message without overwriting a custom title', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-'));
    const store = new AppStore(dataDir);
    try {
      const automatic = store.createConversation();
      store.addMessage(automatic.id, 'user', '  整理一下本周的发布计划\n并标注风险  ');
      assert.equal(store.getConversation(automatic.id).title, '整理一下本周的发布计划 并标注风险');
      store.addMessage(automatic.id, 'user', '不要改标题');
      assert.equal(store.getConversation(automatic.id).title, '整理一下本周的发布计划 并标注风险');

      const custom = store.createConversation('自定义标题');
      store.addMessage(custom.id, 'user', '这条消息不应覆盖标题');
      assert.equal(store.getConversation(custom.id).title, '自定义标题');
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('creates an independent conversation branch through a selected message', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-'));
    const store = new AppStore(dataDir);
    try {
      const source = store.createConversation('原会话');
      const first = store.addMessage(source.id, 'user', '先分析这份资料');
      store.addMessage(source.id, 'assistant', '我先列出关键事实。');
      const third = store.addMessage(source.id, 'user', '再给出两个方案');
      const branch = store.branchConversation(source.id, third.id);
      assert.notEqual(branch.id, source.id);
      assert.equal(branch.title, '原会话 · 分支');
      assert.equal(branch.projectId, source.projectId);
      assert.deepEqual(store.listMessages(branch.id).map((message) => message.content), ['先分析这份资料', '我先列出关键事实。', '再给出两个方案']);
      assert.equal(store.listMessages(source.id).length, 3);
      assert.throws(() => store.branchConversation(source.id, 'missing'), /Message not found/);
      assert.notEqual(first.id, store.listMessages(branch.id)[0].id);
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('persists pin state and places pinned conversations first', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-'));
    const store = new AppStore(dataDir);
    try {
      const first = store.createConversation('普通');
      const second = store.createConversation('重要');
      assert.equal(store.setConversationPinned(first.id, true).pinned, true);
      assert.equal(store.listConversations(true)[0].id, first.id);
      assert.equal(store.setConversationPinned(first.id, false).pinned, false);
      assert.equal(store.listConversations(true).slice(0, 2).some((item) => item.pinned), false);
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('groups conversations into persistent projects and returns them to the default project on deletion', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-'));
    let store = new AppStore(dataDir);
    try {
      const project = store.createConversationProject('玉衡开发');
      const conversation = store.createConversation('侧栏设计', project.id);
      assert.equal(conversation.projectId, project.id);
      assert.equal(store.renameConversationProject(project.id, '玉衡桌面端').name, '玉衡桌面端');

      store.close();
      store = new AppStore(dataDir);
      assert.equal(store.listConversationProjects().find((item) => item.id === project.id)?.name, '玉衡桌面端');
      assert.equal(store.getConversation(conversation.id).projectId, project.id);

      store.deleteConversationProject(project.id);
      assert.equal(store.getConversation(conversation.id).projectId, 'personal');
      assert.equal(store.listConversationProjects().some((item) => item.id === project.id), false);
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('AppStore global search', () => {
  it('searches Chinese conversation content, tasks, and boards with short-query fallback', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-'));
    const store = new AppStore(dataDir);
    try {
      const conversation = store.createConversation('秋季发布讨论');
      const message = store.addMessage(conversation.id, 'user', '请整理本周发布材料并确认负责人');
      const board = store.createTaskBoard('增长实验看板');
      const task = store.createTask({ title: '核对上线清单', description: '包含灰度计划和回滚负责人' }, board.id);

      assert.equal(store.search('整理本周').find((result) => result.id === message.id)?.parentId, conversation.id);
      assert.equal(store.search('本周').find((result) => result.id === message.id)?.kind, 'message');
      assert.equal(store.search('秋季发布').find((result) => result.id === conversation.id)?.kind, 'conversation');
      assert.equal(store.search('回滚负责人').find((result) => result.id === task.id)?.parentId, board.id);
      assert.equal(store.search('增长实验').find((result) => result.id === board.id)?.kind, 'board');
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('reflects renamed, updated, and deleted records without indexing tool output', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-'));
    const store = new AppStore(dataDir);
    try {
      const conversation = store.createConversation('临时发布标题');
      const message = store.addMessage(conversation.id, 'user', '级联删除验证文本');
      const task = store.createTask({ title: '旧任务标题', description: '旧任务说明' });
      store.renameConversation(conversation.id, '正式发布复盘');
      store.updateTask(task.id, { title: '新任务标题', description: '新的验收说明' });

      assert.equal(store.search('正式发布').some((result) => result.id === conversation.id), true);
      assert.equal(store.search('临时发布').some((result) => result.id === conversation.id), false);
      assert.equal(store.search('新的验收').some((result) => result.id === task.id), true);
      assert.equal(store.search('旧任务说明').some((result) => result.id === task.id), false);

      store.startRun('search-tool-run', conversation.id, message.id);
      store.startToolActivity('search-tool-run', 'search-tool-call', 'bash');
      store.finishToolActivity('search-tool-run', 'search-tool-call', 'bash', false, 'SEARCH_PRIVATE_TOOL_OUTPUT_91');
      assert.deepEqual(store.search('SEARCH_PRIVATE_TOOL_OUTPUT_91'), []);

      store.deleteConversation(conversation.id);
      assert.equal(store.search('级联删除验证').some((result) => result.id === message.id), false);
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('finds existing content after reopening the database and returns recent entities for an empty query', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-'));
    let store = new AppStore(dataDir);
    try {
      const conversation = store.createConversation('重启搜索会话');
      const message = store.addMessage(conversation.id, 'assistant', '重启后仍然可以检索的正文');
      const task = store.createTask({ title: '最近任务记录' });
      store.close();
      store = new AppStore(dataDir);

      assert.equal(store.search('仍然可以检索').find((result) => result.id === message.id)?.parentId, conversation.id);
      const recent = store.search('', 20);
      assert.equal(recent.some((result) => result.id === conversation.id && result.kind === 'conversation'), true);
      assert.equal(recent.some((result) => result.id === task.id && result.kind === 'task'), true);
      assert.equal(recent.every((result) => result.kind === 'conversation' || result.kind === 'task'), true);
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('AppStore Skill settings', () => {
  it('persists user registrations and conversation selections independently', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-skills-'));
    const store = new AppStore(dataDir);
    try {
      const first = store.createConversation();
      const second = store.createConversation();
      const registration = { id: 'user-demo', name: 'Demo', description: 'Demo skill', path: '/tmp/demo-skill', enabled: false };
      assert.deepEqual(store.saveSkillRegistrations([registration]), [registration]);
      assert.deepEqual(store.getSkillRegistrations(), [registration]);
      assert.deepEqual(store.saveConversationSkills(first.id, ['user-demo', 'missing', 'user-demo']), ['user-demo', 'missing']);
      assert.deepEqual(store.getConversationSkills(first.id), ['user-demo', 'missing']);
      assert.deepEqual(store.getConversationSkills(second.id), []);
    } finally { store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
  });
});

describe('AppStore Browser Use settings', () => {
  it('keeps the optional browser plugin disabled until explicitly enabled', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-'));
    let store = new AppStore(dataDir);
    try {
      assert.deepEqual(store.getBrowserUseConfig(), { enabled: false });
      assert.deepEqual(store.saveBrowserUseConfig({ enabled: true }), { enabled: true });
      store.close();
      store = new AppStore(dataDir);
      assert.deepEqual(store.getBrowserUseConfig(), { enabled: true });
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('keeps Browser Use and Computer Use mutually exclusive', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-'));
    const store = new AppStore(dataDir);
    try {
      assert.deepEqual(store.saveComputerUseConfig({ enabled: true }), { enabled: true });
      assert.deepEqual(store.getComputerUseConfig(), { enabled: true });
      assert.deepEqual(store.saveBrowserUseConfig({ enabled: true }), { enabled: true });
      assert.deepEqual(store.getBrowserUseConfig(), { enabled: true });
      assert.deepEqual(store.getComputerUseConfig(), { enabled: false });
      const conversation = store.createConversation('能力覆盖');
      assert.deepEqual(store.getConversationCapabilities(conversation.id), { browserUse: 'default', computerUse: 'default' });
      assert.deepEqual(store.getEffectiveConversationCapabilities(conversation.id), { browserUse: true, computerUse: false });
      assert.throws(() => store.saveConversationCapabilities(conversation.id, { browserUse: 'enabled', computerUse: 'enabled' }), /不能同时开启/);
      assert.deepEqual(store.saveConversationCapabilities(conversation.id, { browserUse: 'default', computerUse: 'enabled' }), { browserUse: 'disabled', computerUse: 'enabled' });
      assert.deepEqual(store.getEffectiveConversationCapabilities(conversation.id), { browserUse: false, computerUse: true });
      assert.deepEqual(store.saveConversationCapabilities(conversation.id, { browserUse: 'disabled', computerUse: 'enabled' }), { browserUse: 'disabled', computerUse: 'enabled' });
      assert.deepEqual(store.getEffectiveConversationCapabilities(conversation.id), { browserUse: false, computerUse: true });
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('persists the selected reasoning level across store instances', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-'));
    let store = new AppStore(dataDir);
    let firstId = '';
    let secondId = '';
    try {
      const first = store.createConversation('第一个会话');
      const second = store.createConversation('第二个会话');
      firstId = first.id;
      secondId = second.id;
      assert.equal(store.getReasoningSelection(first.id), 'default');
      store.saveReasoningSelection(first.id, 'xhigh');
      assert.equal(store.getReasoningSelection(first.id), 'xhigh');
      assert.equal(store.getReasoningSelection(second.id), 'default');
      store.close();
      store = new AppStore(dataDir);
      assert.equal(store.getReasoningSelection(firstId), 'xhigh');
      assert.equal(store.getReasoningSelection(secondId), 'default');
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('defaults tool permissions to smart and persists choices per conversation', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-'));
    let store = new AppStore(dataDir);
    let firstId = '';
    let secondId = '';
    try {
      const first = store.createConversation('第一个会话');
      const second = store.createConversation('第二个会话');
      firstId = first.id;
      secondId = second.id;
      assert.equal(store.getToolPermissionMode(first.id), 'smart');
      assert.equal(store.getToolPermissionMode(second.id), 'smart');
      assert.equal(store.saveToolPermissionMode(first.id, 'cautious'), 'cautious');
      assert.equal(store.getToolPermissionMode(first.id), 'cautious');
      assert.equal(store.getToolPermissionMode(second.id), 'smart');
      assert.equal(store.saveToolPermissionMode(first.id, 'full_session'), 'full_session');
      store.close();
      store = new AppStore(dataDir);
      assert.equal(store.getToolPermissionMode(firstId), 'full_session');
      assert.equal(store.getToolPermissionMode(secondId), 'smart');
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('AppStore tasks', () => {
  it('isolates tasks and task types between boards', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-'));
    const store = new AppStore(dataDir);
    try {
      const [defaultBoard] = store.listTaskBoards();
      const workBoard = store.createTaskBoard('工作');
      const defaultType = store.listTaskTypes(defaultBoard.id)[0];
      const workType = store.listTaskTypes(workBoard.id)[0];
      const defaultTask = store.createTask({ title: '默认事项', status: defaultType.id }, defaultBoard.id);
      const workTask = store.createTask({ title: '工作事项', status: workType.id }, workBoard.id);

      assert.deepEqual(store.listTasks(defaultBoard.id).map((task) => task.id), [defaultTask.id]);
      assert.deepEqual(store.listTasks(workBoard.id).map((task) => task.id), [workTask.id]);
      assert.throws(() => store.createTask({ title: '错误归属', status: defaultType.id }, workBoard.id), /Task type not found/);
      assert.equal(store.renameTaskBoard(workBoard.id, '产品工作').name, '产品工作');
      const personalBoard = store.createTaskBoard('个人');
      assert.deepEqual(store.listTaskBoards().map((board) => board.id), [defaultBoard.id, workBoard.id, personalBoard.id]);
      assert.deepEqual(store.reorderTaskBoards(personalBoard.id, defaultBoard.id).map((board) => board.id), [personalBoard.id, defaultBoard.id, workBoard.id]);
      const reviewType = store.createTaskType('审核中', workBoard.id);
      const migratedTask = store.createTask({ title: '迁移任务', description: '保留正文', status: reviewType.id, priority: 'high' }, workBoard.id);
      store.deleteTaskBoard(workBoard.id);
      assert.deepEqual(store.listTaskBoards().map((board) => board.id), [personalBoard.id, defaultBoard.id]);
      assert.throws(() => store.getTask(migratedTask.id), /Task not found/);
      assert.deepEqual(store.listTaskTypes(workBoard.id), []);
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('moves a task into the target board and its first column', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-'));
    const store = new AppStore(dataDir);
    try {
      const [sourceBoard] = store.listTaskBoards();
      const targetBoard = store.createTaskBoard('目标看板');
      const sourceType = store.listTaskTypes(sourceBoard.id)[1];
      const targetType = store.listTaskTypes(targetBoard.id)[0];
      const task = store.createTask({ title: '需要移动', status: sourceType.id }, sourceBoard.id);

      const moved = store.moveTaskToBoard(task.id, targetBoard.id);

      assert.equal(moved.boardId, targetBoard.id);
      assert.equal(moved.status, targetType.id);
      assert.deepEqual(store.listTasks(sourceBoard.id), []);
      assert.deepEqual(store.listTasks(targetBoard.id).map((item) => item.id), [task.id]);
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('allows deleting a non-empty default board and persists the remaining default', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-'));
    let store = new AppStore(dataDir);
    try {
      const [defaultBoard] = store.listTaskBoards();
      const replacement = store.createTaskBoard('新默认');
      const task = store.createTask({ title: '默认任务' }, defaultBoard.id);

      store.deleteTaskBoard(defaultBoard.id);

      assert.equal(store.getDefaultTaskBoardId(), replacement.id);
      assert.throws(() => store.getTask(task.id), /Task not found/);
      store.close();
      store = new AppStore(dataDir);
      assert.equal(store.getDefaultTaskBoardId(), replacement.id);
      assert.equal(store.createTask({ title: '继续使用新默认' }).boardId, replacement.id);
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('deletes an empty board without migration and selects a remaining default when needed', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-'));
    const store = new AppStore(dataDir);
    try {
      const [defaultBoard] = store.listTaskBoards();
      const emptyBoard = store.createTaskBoard('空看板');

      store.deleteTaskBoard(emptyBoard.id, '');
      assert.deepEqual(store.listTaskBoards().map((board) => board.id), [defaultBoard.id]);
      assert.equal(store.getDefaultTaskBoardId(), defaultBoard.id);

      const replacement = store.createTaskBoard('新默认');
      store.deleteTaskBoard(defaultBoard.id, '');
      assert.deepEqual(store.listTaskBoards().map((board) => board.id), [replacement.id]);
      assert.equal(store.getDefaultTaskBoardId(), replacement.id);
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('deletes all task types and tasks in a board', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-'));
    const store = new AppStore(dataDir);
    try {
      const [source] = store.listTaskBoards();
      const sourceType = store.createTaskType('仅源列', source.id);
      const migrating = store.createTask({ title: '无匹配任务', status: sourceType.id }, source.id);

      const target = store.createTaskBoard('目标');
      assert.equal(store.search('无匹配任务').some((result) => result.id === migrating.id), true);
      store.deleteTaskBoard(source.id, target.id);

      assert.throws(() => store.getTask(migrating.id), /Task not found/);
      assert.deepEqual(store.listTaskTypes(source.id), []);
      assert.deepEqual(store.listTasks(target.id), []);
      assert.equal(store.search('无匹配任务').some((result) => result.id === migrating.id), false);
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('rejects deleting the final board without changing data', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-'));
    const store = new AppStore(dataDir);
    try {
      const [onlyBoard] = store.listTaskBoards();
      const task = store.createTask({ title: '不可丢失' }, onlyBoard.id);
      assert.throws(() => store.deleteTaskBoard(onlyBoard.id), /At least one task board is required/);
      assert.deepEqual(store.listTaskBoards().map((board) => board.id), [onlyBoard.id]);
      assert.equal(store.getTask(task.id).title, '不可丢失');
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('creates, updates, archives, and reloads tasks', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-'));
    let store = new AppStore(dataDir);
    try {
      const conversation = store.createConversation('项目讨论');
      const created = store.createTask({
        title: '整理发布清单',
        description: '## 验收项\n\n- [ ] 检查安装包\n- [ ] 更新公告',
        priority: 'high',
        dueAt: '2026-09-01',
        sourceConversationId: conversation.id,
      });
      assert.equal(created.status, 'todo');
      assert.match(created.description, /检查安装包/);
      assert.equal(created.sourceConversationId, conversation.id);

      const updated = store.updateTask(created.id, { title: '确认发布清单', description: '**负责人：** F0x', status: 'in_progress' });
      assert.equal(updated.title, '确认发布清单');
      assert.equal(updated.status, 'in_progress');
      assert.equal(updated.priority, 'high');
      assert.equal(updated.description, '**负责人：** F0x');

      store.updateTask(created.id, { status: 'archived' });
      store.close();
      store = new AppStore(dataDir);

      const [reloaded] = store.listTasks();
      assert.equal(reloaded.id, created.id);
      assert.equal(reloaded.status, 'archived');
      assert.equal(reloaded.dueAt, '2026-09-01');
      assert.equal(reloaded.description, '**负责人：** F0x');
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('persists custom task types and keeps assigned tasks when a type is renamed', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-'));
    let store = new AppStore(dataDir);
    try {
      const review = store.createTaskType('等待审核');
      const task = store.createTask({ title: '提交方案', status: review.id });
      const renamed = store.renameTaskType(review.id, '审核中');

      assert.equal(renamed.name, '审核中');
      assert.equal(store.getTask(task.id).status, review.id);
      store.close();
      store = new AppStore(dataDir);

      assert.deepEqual(store.listTaskTypes().find((type) => type.id === review.id), renamed);
      assert.equal(store.getTask(task.id).status, review.id);
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('deletes empty task types while protecting the last type and assigned tasks', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-'));
    const store = new AppStore(dataDir);
    try {
      const review = store.createTaskType('等待审核');
      const task = store.createTask({ title: '保留任务', status: review.id });
      assert.throws(() => store.deleteTaskType(review.id), /still contains tasks/);
      store.deleteTask(task.id);
      store.deleteTaskType(review.id);
      assert.equal(store.listTaskTypes().some((type) => type.id === review.id), false);

      const remaining = store.listTaskTypes();
      for (const type of remaining.slice(1)) store.deleteTaskType(type.id);
      assert.throws(() => store.deleteTaskType(remaining[0].id), /At least one task type/);
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('persists reminder delivery and only rearms it when the reminder changes', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-'));
    let store = new AppStore(dataDir);
    try {
      const reminderAt = '2026-09-01T01:30:00.000Z';
      const task = store.createTask({ title: '准备晨会', remindAt: reminderAt });
      assert.deepEqual(store.listPendingTaskReminders().map((item) => item.id), [task.id]);

      const delivered = store.markTaskReminderFired(task.id, reminderAt, '2026-09-01T01:30:01.000Z');
      assert.equal(delivered?.reminderFiredAt, '2026-09-01T01:30:01.000Z');
      assert.deepEqual(store.listPendingTaskReminders(), []);

      store.close();
      store = new AppStore(dataDir);
      assert.deepEqual(store.listPendingTaskReminders(), []);

      const rearmed = store.updateTask(task.id, { remindAt: '2026-09-02T01:30:00.000Z' });
      assert.equal(rearmed.reminderFiredAt, null);
      assert.deepEqual(store.listPendingTaskReminders().map((item) => item.id), [task.id]);

      store.updateTask(task.id, { status: 'done' });
      assert.deepEqual(store.listPendingTaskReminders(), []);
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('migrates the legacy fixed-status table without losing tasks', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-store-'));
    const databasePath = path.join(dataDir, 'yuheng.sqlite');
    const legacy = new DatabaseSync(databasePath);
    try {
      legacy.exec(`
        CREATE TABLE tasks (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'done', 'archived')),
          priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
          due_at TEXT,
          source_conversation_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      legacy.prepare(`INSERT INTO tasks (id, title, description, status, priority, due_at, source_conversation_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run('legacy-task', '旧任务', '保留说明', 'in_progress', 'high', null, null, '2026-08-27T00:00:00.000Z', '2026-08-27T00:00:00.000Z');
    } finally {
      legacy.close();
    }

    const store = new AppStore(dataDir);
    try {
      const [defaultBoard] = store.listTaskBoards();
      assert.equal(store.getTask('legacy-task').status, 'in_progress');
      assert.equal(store.getTask('legacy-task').boardId, defaultBoard.id);
      assert.equal(store.getTask('legacy-task').description, '保留说明');
      assert.equal(store.listTaskTypes(defaultBoard.id).find((type) => type.id === 'in_progress')?.name, '进行中');
      const first = store.createTask({ title: '升级后任务一' }, defaultBoard.id);
      const second = store.createTask({ title: '升级后任务二' }, defaultBoard.id);
      store.reorderTask(second.id, first.id);
      assert.deepEqual(store.listTasks(defaultBoard.id).filter((task) => task.status === first.status).map((task) => task.title), ['升级后任务二', '升级后任务一']);
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('Conversation backups', () => {
  it('exports messages and imports them with fresh identity and provider fallback', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-backup-'));
    const store = new AppStore(dataDir);
    try {
      const original = store.createConversation('备份测试');
      const message = store.addMessage(original.id, 'user', '保留这段内容');
      store.addMessage(original.id, 'assistant', '已保留');
      const backup = store.exportConversation(original.id);
      assert.equal('runs' in backup, false);
      backup.conversation.providerId = 'missing-provider';
      const imported = store.importConversation(backup);
      assert.notEqual(imported.id, original.id);
      assert.equal(imported.title, '备份测试');
      assert.equal(store.listMessages(imported.id).map(({ content }) => content).join('|'), '保留这段内容|已保留');
      assert.notEqual(store.listMessages(imported.id)[0].id, message.id);
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('TaskAssetStore', () => {
  it('copies an attachment into managed storage and only resolves managed URLs', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuheng-assets-'));
    const assets = new TaskAssetStore(dataDir);
    try {
      const saved = await assets.import('计划.md', 'text/markdown', new TextEncoder().encode('# 发布计划'));
      assert.equal(saved.name, '计划.md');
      assert.equal(await fs.promises.readFile(assets.resolveUrl(saved.url), 'utf8'), '# 发布计划');
      assert.throws(() => assets.resolveUrl('file:///tmp/private.txt'), /Invalid task asset URL/);
      assert.throws(() => assets.resolveUrl('yuheng-task-asset://local/../private.txt'), /Invalid task asset URL/);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
