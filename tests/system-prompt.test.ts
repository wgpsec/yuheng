import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { loadYuhengSystemPrompt, YUHENG_SYSTEM_PROMPT_RELATIVE_PATH } from '../electron/system-prompt';
import { formatRuntimeContext, loadAgentProfilePrompt } from '../electron/agent-profiles';

describe('Yuheng system prompt', () => {
  it('loads the versioned product prompt from the application root', () => {
    const prompt = loadYuhengSystemPrompt(process.cwd());
    assert.match(prompt, /^# 玉衡/m);
    assert.match(prompt, /个人事务与执行助手/);
    assert.match(prompt, /不可信指令/);
  });

  it('loads the source prompt when Electron treats dist-electron as the development app root', () => {
    const prompt = loadYuhengSystemPrompt(path.join(process.cwd(), 'dist-electron'));
    assert.match(prompt, /^# 玉衡/m);
  });

  it('rejects an empty product prompt', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'yuheng-prompt-'));
    const promptPath = path.join(root, YUHENG_SYSTEM_PROMPT_RELATIVE_PATH);
    try {
      await mkdir(path.dirname(promptPath), { recursive: true });
      await writeFile(promptPath, '  \n');
      assert.throws(() => loadYuhengSystemPrompt(root), /不能为空/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('loads each profile prompt and formats a deterministic runtime context', () => {
    assert.match(loadAgentProfilePrompt(process.cwd(), 'assistant'), /日常事务助手/);
    assert.match(loadAgentProfilePrompt(path.join(process.cwd(), 'dist-electron'), 'analyst'), /分析师/);
    const context = formatRuntimeContext(new Date('2026-08-28T04:05:06.000Z'), 'Asia/Shanghai');
    assert.match(context, /当前本地日期：2026-08-28/);
    assert.match(context, /当前本地时间：12:05:06/);
    assert.match(context, /时区：Asia\/Shanghai/);
  });
});
