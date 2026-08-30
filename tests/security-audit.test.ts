import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { FileSecurityAuditLog } from '../electron/security-audit';
import type { SecurityAuditEvent } from '../electron/security-policy';

const event: SecurityAuditEvent = {
  timestamp: '2026-08-31T00:00:00.000Z',
  runId: 'run-1',
  conversationId: 'conversation-1',
  toolCallId: 'call-1',
  toolName: 'write',
  risk: 'write',
  decision: 'approved',
  reason: 'Workspace mutations require explicit approval.',
};

describe('security audit log', () => {
  it('writes private JSONL and rotates a full audit file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'yuheng-audit-'));
    const file = path.join(root, 'security-audit.jsonl');
    await writeFile(file, Buffer.alloc(1024 * 1024));

    new FileSecurityAuditLog(root).record(event);

    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await stat(`${file}.1`)).size, 1024 * 1024);
    assert.deepEqual(JSON.parse((await readFile(file, 'utf8')).trim()), event);
  });
});
