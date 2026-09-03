import assert from 'node:assert/strict';
import { access, chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import test from 'node:test';
import { ProjectRunWorkspace } from '../electron/runs/project-run-workspace';

test('stages run attachments read-only inside an isolated project workspace', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'yuheng-project-workspace-'));
  const manager = new ProjectRunWorkspace(root);
  const csv = Buffer.from('name,count\nalpha,3\n');
  const sourcePath = path.join(root, 'weekly.csv');
  await writeFile(sourcePath, csv);
  const prepared = await manager.prepare('project-a', 'run-a', [
    { id: 'attachment-a', name: 'weekly.csv', mimeType: 'text/csv', size: csv.byteLength, sourcePath },
  ]);

  assert.equal(prepared.projectDirectory, manager.projectDirectory('project-a'));
  assert.equal(prepared.attachments.length, 1);
  assert.equal(prepared.attachments[0].relativePath, '.yuheng/runs/run-a/attachments/weekly.csv');
  assert.equal(await readFile(prepared.attachments[0].absolutePath, 'utf8'), csv.toString('utf8'));
  assert.equal((await stat(prepared.attachments[0].absolutePath)).mode & 0o777, 0o400);
  assert.equal((await stat(prepared.attachmentDirectory)).mode & 0o777, 0o500);
  assert.match(prepared.promptContext, /"name":"weekly\.csv"/);
  assert.match(prepared.promptContext, /"mimeType":"text\/csv"/);
  assert.match(prepared.promptContext, /"sizeBytes":19/);
  assert.match(prepared.promptContext, /直接对上述路径使用文件读取或结构化解析工具/);
  assert.match(prepared.promptContext, /不得为了寻找这些附件而扫描项目目录之外/);
  assert.doesNotMatch(prepared.promptContext, /alpha,3/);

  await prepared.cleanup();
  await assert.rejects(access(prepared.runDirectory, constants.F_OK));
  await access(prepared.projectDirectory, constants.F_OK);
});

test('keeps projects isolated and resolves duplicate attachment names', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'yuheng-project-workspace-'));
  const manager = new ProjectRunWorkspace(root);
  const data = Buffer.from('value');
  const firstSourcePath = path.join(root, 'first.csv');
  const secondSourcePath = path.join(root, 'second.csv');
  await writeFile(firstSourcePath, data);
  await writeFile(secondSourcePath, data);
  const first = await manager.prepare('project-a', 'run-a', [
    { id: 'one', name: '../report.csv', mimeType: 'text/csv', size: data.byteLength, sourcePath: firstSourcePath },
    { id: 'two', name: 'report.csv', mimeType: 'text/csv', size: data.byteLength, sourcePath: secondSourcePath },
  ]);
  const second = await manager.prepare('project-b', 'run-b', []);

  assert.notEqual(first.projectDirectory, second.projectDirectory);
  assert.deepEqual(first.attachments.map((item) => path.basename(item.absolutePath)), ['report.csv', 'report (2).csv']);
  assert.ok(first.attachments.every((item) => item.absolutePath.startsWith(`${first.attachmentDirectory}${path.sep}`)));

  await first.cleanup();
  await second.cleanup();
});

test('uses a selected project directory without changing its permissions', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'yuheng-project-workspace-'));
  const selected = await mkdtemp(path.join(tmpdir(), 'yuheng-selected-workspace-'));
  await chmod(selected, 0o755);
  const manager = new ProjectRunWorkspace(root);
  const prepared = await manager.prepare('project-a', 'run-a', [], selected);

  assert.equal(prepared.projectDirectory, path.resolve(selected));
  assert.equal((await stat(selected)).mode & 0o777, 0o755);
  assert.equal(prepared.attachments.length, 0);
  await prepared.cleanup();
  await access(selected, constants.F_OK);
});

test('rejects a configured project directory that is missing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'yuheng-project-workspace-'));
  const manager = new ProjectRunWorkspace(root);
  await assert.rejects(
    manager.prepare('project-a', 'run-a', [], path.join(root, 'missing-project-directory')),
    /项目工作目录不存在或不是文件夹/u,
  );
});

test('cleans only the recovered run directory identified by the database', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'yuheng-project-workspace-'));
  const manager = new ProjectRunWorkspace(root);
  const stale = path.join(manager.projectDirectory('project-a'), '.yuheng', 'runs', 'run-a');
  const unknown = path.join(manager.projectDirectory('project-a'), '.yuheng', 'runs', 'unknown');
  await mkdir(stale, { recursive: true });
  await mkdir(unknown, { recursive: true });
  await manager.cleanupRecoveredRun('project-a', 'run-a');
  await assert.rejects(access(stale, constants.F_OK));
  await access(unknown, constants.F_OK);
});
