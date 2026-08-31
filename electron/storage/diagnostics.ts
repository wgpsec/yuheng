import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type DiagnosticInput = {
  appVersion: string;
  electronVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  stage: string;
  code: string;
  retryable: boolean;
  currentVersion?: number;
  targetVersion: number;
  ledger: Array<{ version: number; name: string; source: 'applied' | 'adopted' }>;
  snapshots: Array<{ id: string; status: string; sha256: string; sourceVersion: number; targetVersion: number }>;
  integrity: { quickCheck: string[]; foreignKeyViolationCount: number };
  errorSummary?: string;
  userMessage: string;
};

export type DiagnosticReport = DiagnosticInput & {
  diagnosticId: string;
  recordedAt: string;
};

export type DiagnosticStoreDependencies = {
  now?: () => Date;
  id?: () => string;
};

export class DiagnosticStore {
  readonly diagnosticsDirectory: string;
  private readonly now: () => Date;
  private readonly id: () => string;
  private readonly reports = new Map<string, DiagnosticReport>();

  constructor(dataDirectory: string, dependencies: DiagnosticStoreDependencies = {}) {
    this.diagnosticsDirectory = path.join(dataDirectory, 'recovery', 'diagnostics');
    this.now = dependencies.now ?? (() => new Date());
    this.id = dependencies.id ?? randomUUID;
  }

  record(input: DiagnosticInput): DiagnosticReport {
    const report: DiagnosticReport = {
      ...input,
      diagnosticId: this.id(),
      recordedAt: this.now().toISOString(),
      errorSummary: redact(input.errorSummary ?? ''),
      userMessage: redact(input.userMessage),
      ledger: input.ledger.map(({ version, name, source }) => ({ version, name, source })),
      snapshots: input.snapshots.map(({ id, status, sha256, sourceVersion, targetVersion }) => ({ id, status, sha256, sourceVersion, targetVersion })),
    };
    this.reports.set(report.diagnosticId, report);
    return report;
  }

  async export(diagnosticId: string, targetPath: string): Promise<void> {
    const report = this.reports.get(diagnosticId) ?? this.readPersisted(diagnosticId);
    if (!report) throw new Error('Diagnostic not found.');
    const temporaryPath = `${targetPath}.tmp`;
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    const descriptor = fs.openSync(temporaryPath, 'r');
    try { fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    fs.renameSync(temporaryPath, targetPath);
  }

  persist(report: DiagnosticReport): void {
    fs.mkdirSync(this.diagnosticsDirectory, { recursive: true });
    const targetPath = path.join(this.diagnosticsDirectory, `${report.diagnosticId}.json`);
    const temporaryPath = `${targetPath}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporaryPath, targetPath);
    this.reports.set(report.diagnosticId, report);
  }

  private readPersisted(diagnosticId: string): DiagnosticReport | null {
    if (!/^[a-zA-Z0-9-]+$/u.test(diagnosticId)) return null;
    const filePath = path.join(this.diagnosticsDirectory, `${diagnosticId}.json`);
    try {
      const value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as DiagnosticReport;
      return value.diagnosticId === diagnosticId ? value : null;
    } catch { return null; }
  }
}

function redact(value: string): string {
  return value
    .replace(/(?:\/Users|\/home|[A-Za-z]:\\)[^\s'"`]*/gu, '<redacted-path>')
    .replace(/(?:api[_-]?key|secret|token|password)\s*[:=]\s*[^\s,;]+/giu, '<redacted-secret>')
    .replace(/(?:SQLite|SQLITE_ERROR|SQLITE_CONSTRAINT|SQLITE_BUSY|SQLITE_CORRUPT)[^\n]*/gu, '<redacted-sqlite-error>')
    .slice(0, 500);
}
