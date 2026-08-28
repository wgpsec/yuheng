import { readFileSync } from 'node:fs';
import path from 'node:path';

export const YUHENG_SYSTEM_PROMPT_RELATIVE_PATH = path.join('electron', 'prompts', 'yuheng-system.md');

export function loadYuhengSystemPrompt(appRoot: string): string {
  const promptPaths = [path.join(appRoot, YUHENG_SYSTEM_PROMPT_RELATIVE_PATH)];
  if (path.basename(appRoot) === 'dist-electron') {
    promptPaths.push(path.join(path.dirname(appRoot), YUHENG_SYSTEM_PROMPT_RELATIVE_PATH));
  }

  for (const promptPath of promptPaths) {
    try {
      const prompt = readFileSync(promptPath, 'utf8').replace(/^\uFEFF/, '').trim();
      if (!prompt) throw new Error(`玉衡系统提示词不能为空：${promptPath}`);
      return prompt;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      if (error instanceof Error && error.message.startsWith('玉衡系统提示词不能为空')) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`无法加载玉衡系统提示词：${promptPath}（${detail}）`);
    }
  }

  throw new Error(`无法加载玉衡系统提示词：未在以下位置找到文件：${promptPaths.join('、')}`);
}
