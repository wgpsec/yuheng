import { readFileSync } from 'node:fs';
import path from 'node:path';

export type AgentProfileId = 'assistant' | 'analyst' | 'auditor';
export type TimeContextPolicy = 'full' | 'none';
export type AgentProfile = { id: AgentProfileId; name: string; description: string; timeContext: TimeContextPolicy; promptFile: string };

export const DEFAULT_AGENT_PROFILE_ID: AgentProfileId = 'assistant';
export const AGENT_PROFILES: readonly AgentProfile[] = [
  { id: 'assistant', name: '助手', description: '处理日常事务、任务和计划', timeContext: 'full', promptFile: 'assistant.md' },
  { id: 'analyst', name: '分析师', description: '整理资料、比较信息和推导结论', timeContext: 'none', promptFile: 'analyst.md' },
  { id: 'auditor', name: '审计专家', description: '核验事实、证据和变更记录', timeContext: 'none', promptFile: 'auditor.md' },
];

export function isAgentProfileId(value: unknown): value is AgentProfileId {
  return AGENT_PROFILES.some((profile) => profile.id === value);
}

export function getAgentProfile(id: AgentProfileId): AgentProfile {
  return AGENT_PROFILES.find((profile) => profile.id === id) ?? AGENT_PROFILES[0];
}

export function loadAgentProfilePrompt(appRoot: string, profileId: AgentProfileId): string {
  const profile = getAgentProfile(profileId);
  const relativePath = path.join('electron', 'prompts', 'profiles', profile.promptFile);
  const promptPaths = [path.join(appRoot, relativePath)];
  if (path.basename(appRoot) === 'dist-electron') promptPaths.push(path.join(path.dirname(appRoot), relativePath));
  for (const promptPath of promptPaths) {
    try {
      const prompt = readFileSync(promptPath, 'utf8').replace(/^\uFEFF/, '').trim();
      if (!prompt) throw new Error(`Profile 提示词不能为空：${promptPath}`);
      return prompt;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`无法加载 Profile 提示词：${promptPath}（${detail}）`);
    }
  }
  throw new Error(`无法加载 Profile 提示词：${profileId}`);
}

export function formatRuntimeContext(now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'): string {
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return ['<runtime_context>', `当前本地日期：${values.year}-${values.month}-${values.day}（${values.weekday ?? ''}）`, `当前本地时间：${values.hour}:${values.minute}:${values.second}`, `时区：${timeZone}`, `UTC 时间：${now.toISOString()}`, '涉及今天、明天、本周等相对日期时，以上下文是本轮可信时间；不要仅为了获取当前时间调用 date 或其他工具。', '</runtime_context>'].join('\n');
}
