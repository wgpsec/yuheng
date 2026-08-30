import fs from 'node:fs';
import path from 'node:path';
import type { SecurityAuditEvent, SecurityAuditSink } from './security-policy';

const MAX_AUDIT_BYTES = 1024 * 1024;

export class FileSecurityAuditLog implements SecurityAuditSink {
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'security-audit.jsonl');
  }

  record(event: SecurityAuditEvent): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    try {
      if (fs.statSync(this.filePath).size >= MAX_AUDIT_BYTES) {
        const rotated = `${this.filePath}.1`;
        try { fs.rmSync(rotated, { force: true }); } catch { /* best effort */ }
        fs.renameSync(this.filePath, rotated);
      }
    } catch { /* first event */ }
    fs.appendFileSync(this.filePath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
  }
}
