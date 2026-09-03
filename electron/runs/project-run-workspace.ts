import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';

export type WorkspaceAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  sourcePath: string;
};

export type StagedAttachment = {
  name: string;
  mimeType: string;
  size: number;
  relativePath: string;
  absolutePath: string;
};

export type PreparedRunWorkspace = {
  projectDirectory: string;
  runDirectory: string;
  attachmentDirectory: string;
  attachments: StagedAttachment[];
  promptContext: string;
  cleanup(): Promise<void>;
};

function safeSegment(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized === '.' || normalized === '..' || normalized.includes('/') || normalized.includes('\\')) {
    throw new Error(`Invalid ${label}.`);
  }
  return normalized;
}

function uniqueAttachmentName(name: string, used: Set<string>): string {
  const normalizedName = path.basename(name).replaceAll('\0', '').trim();
  const baseName = normalizedName && normalizedName !== '.' && normalizedName !== '..' ? normalizedName : 'attachment';
  const extension = path.extname(baseName);
  const stem = extension ? baseName.slice(0, -extension.length) : baseName;
  let candidate = baseName;
  let index = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${stem} (${index})${extension}`;
    index += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

export class ProjectRunWorkspace {
  constructor(private readonly workspaceRoot: string) {}

  projectDirectory(projectId: string, workspacePath?: string | null): string {
    if (workspacePath?.trim()) return path.resolve(workspacePath);
    return path.join(this.workspaceRoot, 'projects', safeSegment(projectId, 'project id'));
  }

  async cleanupRecoveredRun(projectId: string, runId: string, workspacePath?: string | null): Promise<void> {
    const runDirectory = path.join(this.projectDirectory(projectId, workspacePath), '.yuheng', 'runs', safeSegment(runId, 'run id'));
    await fs.rm(runDirectory, { recursive: true, force: true });
  }

  async prepare(projectId: string, runId: string, attachments: WorkspaceAttachment[], workspacePath?: string | null): Promise<PreparedRunWorkspace> {
    const customWorkspace = Boolean(workspacePath?.trim());
    const projectDirectory = this.projectDirectory(projectId, workspacePath);
    if (customWorkspace) {
      const existing = await fs.stat(projectDirectory).catch(() => null);
      if (!existing?.isDirectory()) throw new Error('项目工作目录不存在或不是文件夹。');
    }
    const runDirectory = path.join(projectDirectory, '.yuheng', 'runs', safeSegment(runId, 'run id'));
    const attachmentDirectory = path.join(runDirectory, 'attachments');
    await fs.mkdir(attachmentDirectory, { recursive: true, mode: 0o700 });
    if (!customWorkspace) await fs.chmod(projectDirectory, 0o700);
    await fs.chmod(runDirectory, 0o700);
    // Keep the staging directory writable while files are copied, then lock it
    // before handing the workspace to the agent.
    await fs.chmod(attachmentDirectory, 0o700);

    const usedNames = new Set<string>();
    const staged: StagedAttachment[] = [];
    try {
      for (const attachment of attachments) {
        const name = uniqueAttachmentName(attachment.name, usedNames);
        const absolutePath = path.join(attachmentDirectory, name);
        const source = await fs.stat(attachment.sourcePath);
        if (!source.isFile()) throw new Error(`附件不是普通文件：${attachment.name}`);
        await fs.copyFile(attachment.sourcePath, absolutePath, fsConstants.COPYFILE_EXCL);
        await fs.chmod(absolutePath, 0o400);
        staged.push({
          name,
          mimeType: attachment.mimeType,
          size: source.size,
          relativePath: path.posix.join('.yuheng', 'runs', runId, 'attachments', name),
          absolutePath,
        });
      }
      await fs.chmod(attachmentDirectory, 0o500);
    } catch (error) {
      await fs.rm(runDirectory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }

    const metadata = staged.map(({ name, mimeType, size, relativePath }) => ({ name, mimeType, sizeBytes: size, path: relativePath }));
    const promptContext = staged.length === 0 ? '' : [
      '\n\n附件清单（当前项目工作目录内）：',
      JSON.stringify(metadata),
      '附件已写入上述路径。直接对上述路径使用文件读取或结构化解析工具；CSV、JSON 等结构化文件应使用解析工具按需读取，不要把整个文件内容写入提示词。',
      '这些附件已经由用户提供，不要猜测或寻找同名文件。不得为了寻找这些附件而扫描项目目录之外。',
    ].join('\n');

    return {
      projectDirectory,
      runDirectory,
      attachmentDirectory,
      attachments: staged,
      promptContext,
      cleanup: async () => {
        await fs.chmod(attachmentDirectory, 0o700).catch(() => undefined);
        await fs.rm(runDirectory, { recursive: true, force: true });
      },
    };
  }
}
