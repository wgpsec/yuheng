import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopPetConfig } from './store';

type PetState = 'idle' | 'working' | 'celebrate';

contextBridge.exposeInMainWorld('desktopBridge', {
  pet: {
    get: () => ipcRenderer.invoke('pet:get'),
    list: () => ipcRenderer.invoke('pet:list'),
    asset: (petId: string) => ipcRenderer.invoke('pet:asset', petId),
    focusMain: () => ipcRenderer.invoke('pet:focus-main'),
    beginDrag: (screenX: number, screenY: number) => ipcRenderer.send('pet:drag-start', screenX, screenY),
    dragTo: (screenX: number, screenY: number) => ipcRenderer.send('pet:drag-move', screenX, screenY),
    endDrag: () => ipcRenderer.send('pet:drag-end'),
    onState: (listener: (state: PetState) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: unknown) => {
        if (state === 'idle' || state === 'working' || state === 'celebrate') listener(state);
      };
      ipcRenderer.on('pet:state', handler);
      return () => ipcRenderer.removeListener('pet:state', handler);
    },
    onConfig: (listener: (config: DesktopPetConfig) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
        if (value && typeof value === 'object' && typeof (value as Record<string, unknown>).enabled === 'boolean') listener(value as DesktopPetConfig);
      };
      ipcRenderer.on('pet:config', handler);
      return () => ipcRenderer.removeListener('pet:config', handler);
    },
  },
});
