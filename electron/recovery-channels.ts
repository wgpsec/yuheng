export const RECOVERY_CHANNELS = {
  getStatus: 'recovery:get-status',
  retry: 'recovery:retry',
  listSnapshots: 'recovery:list-snapshots',
  restoreSnapshot: 'recovery:restore-snapshot',
  exportDiagnostics: 'recovery:export-diagnostics',
  openDataDirectory: 'recovery:open-data-directory',
  openLogDirectory: 'recovery:open-log-directory',
  quit: 'recovery:quit',
} as const;
