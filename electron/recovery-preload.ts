import { contextBridge, ipcRenderer } from 'electron';
import { RECOVERY_CHANNELS } from './recovery-channels';

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
