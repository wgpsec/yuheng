import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export type YuhengSkillId = 'computer-use';
export type SkillSource = 'yuheng' | 'user';

export type UserSkillRegistration = {
  id: string;
  name: string;
  description: string;
  path: string;
  enabled: boolean;
};

export type YuhengSkillCatalogEntry = {
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  requiredCapability?: 'computerUse';
  path: string;
  available: boolean;
  enabled?: boolean;
};

const SKILL_METADATA: ReadonlyArray<Omit<YuhengSkillCatalogEntry, 'path' | 'available'>> = [
  {
    id: 'computer-use',
    name: 'Computer Use 操作规范',
    description: '刷新窗口引用、区分权限和窗口错误，并限制桌面操作重试。',
    source: 'yuheng',
    requiredCapability: 'computerUse',
  },
];

export function yuhengSkillsDirectory(applicationPath?: string): string {
  const roots = [
    ...(applicationPath ? [applicationPath] : []),
    ...(process.resourcesPath ? [path.join(process.resourcesPath, 'app.asar')] : []),
    __dirname,
    process.cwd(),
  ];
  for (const root of roots) {
    const candidates = [
      path.join(root, 'electron', 'skills'),
      path.join(root, 'skills'),
    ];
    const match = candidates.find((candidate) => fs.existsSync(candidate));
    if (match) return match;
  }
  return path.join(applicationPath ?? process.cwd(), 'electron', 'skills');
}

export function listYuhengSkills(applicationPath?: string): YuhengSkillCatalogEntry[] {
  const directory = yuhengSkillsDirectory(applicationPath);
  return SKILL_METADATA.map((skill) => {
    const skillPath = path.join(directory, skill.id);
    return { ...skill, path: skillPath, available: fs.existsSync(path.join(skillPath, 'SKILL.md')) };
  });
}

export function listSkills(applicationPath?: string, registrations: UserSkillRegistration[] = []): YuhengSkillCatalogEntry[] {
  const builtIn = listYuhengSkills(applicationPath).map((skill) => ({ ...skill, enabled: true }));
  const user = registrations.map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    source: 'user' as const,
    path: skill.path,
    available: fs.existsSync(path.join(skill.path, 'SKILL.md')),
    enabled: skill.enabled,
  }));
  return [...builtIn, ...user];
}

export function importSkill(inputPath: string): UserSkillRegistration {
  const resolved = path.resolve(inputPath);
  const stat = fs.statSync(resolved);
  const directory = stat.isDirectory() ? resolved : path.dirname(resolved);
  const skillFile = path.join(directory, 'SKILL.md');
  if (!fs.existsSync(skillFile)) throw new Error('所选目录中未找到 SKILL.md。');
  const content = fs.readFileSync(skillFile, 'utf8');
  const frontmatter = content.match(/^---\s*\n([\s\S]*?)\n---/m)?.[1] ?? '';
  const field = (key: string): string | undefined => {
    const value = frontmatter.match(new RegExp(`^${key}\\s*:\\s*(.+)$`, 'mi'))?.[1]?.trim();
    return value?.replace(/^['"]|['"]$/g, '');
  };
  return {
    id: `user-${crypto.randomUUID()}`,
    name: field('name') || path.basename(directory),
    description: field('description') || '用户导入的 Skill',
    path: directory,
    enabled: false,
  };
}

export function enabledYuhengSkillPaths(applicationPath?: string, computerUse = false): string[] {
  if (!computerUse) return [];
  return listYuhengSkills(applicationPath)
    .filter((skill) => skill.id === 'computer-use' && skill.available)
    .map((skill) => skill.path);
}

export function enabledSkillPaths(applicationPath: string | undefined, computerUse: boolean, registrations: UserSkillRegistration[], selectedIds: string[] = []): string[] {
  const catalog = listSkills(applicationPath, registrations);
  return catalog.filter((skill) => {
    if (!skill.available) return false;
    if (skill.source === 'yuheng') return skill.id === 'computer-use' && computerUse;
    return skill.enabled === true && selectedIds.includes(skill.id);
  }).map((skill) => skill.path);
}
