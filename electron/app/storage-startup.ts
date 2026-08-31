import { randomUUID } from 'node:crypto';
import type { DatabaseOwner } from '../storage/database';
import { prepareDatabase } from '../storage/database-preparation';
import type { StorageFailure } from '../storage/recovery-types';
import { DiagnosticStore } from '../storage/diagnostics';
import { migrations } from '../storage/migrations';
import type { DatabaseStartup } from './startup-coordinator';
import type { StartupFailure } from './startup-result';

export function createStorageStartup(dataDirectory: string, appVersion: string): DatabaseStartup<DatabaseOwner> {
  return {
    async prepare(reportStage) {
      reportStage('checking');
      const result = await prepareDatabase(dataDirectory, { appVersion });
      if (result.status === 'recovery_required') {
        return { status: 'recovery_required', failure: mapStorageFailure(result.failure) };
      }

      if (result.snapshot) {
        reportStage('snapshotting');
        reportStage('migrating');
      }
      reportStage('verifying');
      return {
        status: 'ready',
        database: {
          value: result.owner,
          close: () => result.owner.close(),
        },
      };
    },
  };
}

export function mapStorageFailure(failure: StorageFailure): StartupFailure {
  return {
    code: failure.code,
    stage: startupFailureStage(failure.stage),
    retryable: failure.retryable,
    userMessage: failure.userMessage,
    diagnosticId: failure.diagnosticId,
    currentSchemaVersion: failure.currentVersion,
    targetSchemaVersion: failure.targetVersion,
  };
}

export function recordUnexpectedStartupFailure(
  dataDirectory: string,
  appVersion: string,
  error: unknown,
  stage: StartupFailure['stage'],
): StartupFailure {
  const userMessage = '玉衡启动时发生未预期错误，请重试或导出诊断信息。';
  let diagnosticId: string = randomUUID();
  try {
    const diagnostics = new DiagnosticStore(dataDirectory);
    const report = diagnostics.record({
      appVersion,
      electronVersion: process.versions.electron ?? 'unknown',
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      stage,
      code: 'initialization_failed',
      retryable: true,
      targetVersion: migrations.length,
      ledger: [],
      snapshots: [],
      integrity: { quickCheck: [], foreignKeyViolationCount: 0 },
      errorSummary: error instanceof Error ? error.message : 'Unexpected startup failure.',
      userMessage,
    });
    diagnostics.persist(report);
    diagnosticId = report.diagnosticId;
  } catch {
    // Diagnostics are best effort; recovery mode must remain available on read-only storage.
  }
  return {
    code: 'initialization_failed',
    stage,
    retryable: true,
    userMessage,
    diagnosticId,
    targetSchemaVersion: migrations.length,
  };
}

function startupFailureStage(stage: string): StartupFailure['stage'] {
  switch (stage) {
    case 'preflight':
    case 'checking':
    case 'snapshotting':
    case 'migrating':
    case 'verifying':
    case 'initializing':
      return stage;
    default:
      return 'checking';
  }
}
