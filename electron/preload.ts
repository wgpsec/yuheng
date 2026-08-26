import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktopBridge', {
  app: {
    getInfo: () => ipcRenderer.invoke('app:get-info'),
  },
  conversations: {
    list: () => ipcRenderer.invoke('conversations:list'),
    messages: (conversationId: string) => ipcRenderer.invoke('conversations:messages', conversationId),
    create: (title?: string) => ipcRenderer.invoke('conversations:create', title),
  },
  provider: {
    get: () => ipcRenderer.invoke('provider:get'),
    save: (config: unknown) => ipcRenderer.invoke('provider:save', config),
  },
  attachments: {
    pick: () => ipcRenderer.invoke('attachments:pick'),
    release: (attachmentIds: string[]) => ipcRenderer.invoke('attachments:release', attachmentIds),
  },
  runs: {
    list: (conversationId: string) => ipcRenderer.invoke('runs:list', conversationId),
    start: (conversationId: string, content: string, attachmentIds?: string[]) => ipcRenderer.invoke('runs:start', conversationId, content, attachmentIds),
    cancel: (runId: string) => ipcRenderer.invoke('runs:cancel', runId),
    onEvent: (listener: (event: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
      ipcRenderer.on('run:event', handler);
      return () => ipcRenderer.removeListener('run:event', handler);
    },
  },
});
