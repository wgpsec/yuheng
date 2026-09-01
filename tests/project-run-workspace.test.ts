import assert from 'node:assert/strict';
import { access, readFile, stat } from 'node:fs/promises';
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
  const prepared = await manager.prepare('project-a', 'run-a', [
    { id: 'attachment-a', name: 'weekly.csv', mimeType: 'text/csv', size: csv.byteLength, data: csv },
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
  const first = await manager.prepare('project-a', 'run-a', [
    { id: 'one', name: '../report.csv', mimeType: 'text/csv', size: data.byteLength, data },
    { id: 'two', name: 'report.csv', mimeType: 'text/csv', size: data.byteLength, data },
  ]);
  const second = await manager.prepare('project-b', 'run-b', []);

  assert.notEqual(first.projectDirectory, second.projectDirectory);
  assert.deepEqual(first.attachments.map((item) => path.basename(item.absolutePath)), ['report.csv', 'report (2).csv']);
  assert.ok(first.attachments.every((item) => item.absolutePath.startsWith(`${first.attachmentDirectory}${path.sep}`)));

  await first.cleanup();
  await second.cleanup();
});
