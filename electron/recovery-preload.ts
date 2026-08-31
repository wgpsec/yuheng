import { contextBridge, ipcRenderer } from 'electron';

// Sandboxed preloads cannot require local modules at runtime.
const RECOVERY_CHANNELS = {
  getStatus: 'recovery:get-status',
  retry: 'recovery:retry',
  listSnapshots: 'recovery:list-snapshots',
  restoreSnapshot: 'recovery:restore-snapshot',
  exportDiagnostics: 'recovery:export-diagnostics',
  openDataDirectory: 'recovery:open-data-directory',
  openLogDirectory: 'recovery:open-log-directory',
  quit: 'recovery:quit',
} as const;

contextBridge.exposeInMainWorld('recoveryBridge', {
  getStatus: () => ipcRenderer.invoke(RECOVERY_CHANNELS.getStatus),
  retry: () => ipcRenderer.invoke(RECOVERY_CHANNELS.retry),
  listSnapshots: () => ipcRenderer.invoke(RECOVERY_CHANNELS.listSnapshots),
  restoreSnapshot: (snapshotId: string) => ipcRenderer.invoke(RECOVERY_CHANNELS.restoreSnapshot, snapshotId),
  exportDiagnostics: () => ipcRenderer.invoke(RECOVERY_CHANNELS.exportDiagnostics),
  openDataDirectory: () => ipcRenderer.invoke(RECOVERY_CHANNELS.openDataDirectory),
  openLogDirectory: () => ipcRenderer.invoke(RECOVERY_CHANNELS.openLogDirectory),
  quit: () => ipcRenderer.invoke(RECOVERY_CHANNELS.quit),
});
