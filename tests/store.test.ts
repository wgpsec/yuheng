import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { AppStore } from '../electron/store';
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
      store.close();
      store = new AppStore(dataDir);

      const [run] = store.listRuns(conversation.id);
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

describe('AppStore conversations', () => {
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
      assert.deepEqual(store.listConversations(), [{ id: 'legacy', projectId: 'personal', title: '历史会话', updatedAt: '2026-08-01T00:00:00.000Z', archived: false, pinned: false }]);
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
      assert.deepEqual(store.getBrowserUseConfig(), { enabled: false });
      assert.deepEqual(store.saveBrowserUseConfig({ enabled: true }), { enabled: true });
      assert.deepEqual(store.getBrowserUseConfig(), { enabled: true });
      assert.deepEqual(store.getComputerUseConfig(), { enabled: false });
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
