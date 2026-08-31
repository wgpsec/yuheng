import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopPetConfig } from './store';
import type { PetFeedback, PetOpenTarget, PetState } from './pet-state';

const PET_STATES = ['idle', 'thinking', 'working', 'attention', 'error', 'celebrate'] as const;

function isPetState(value: unknown): value is PetState {
  return typeof value === 'string' && PET_STATES.includes(value as PetState);
}

function parsePetOpenTarget(value: unknown): PetOpenTarget | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Record<string, unknown>;
  const safeId = (candidate: unknown): string | undefined => {
    if (typeof candidate !== 'string') return undefined;
    const trimmed = candidate.trim();
    return trimmed && trimmed.length <= 256 ? trimmed : undefined;
  };
  const conversationId = safeId(input.conversationId);
  const runId = safeId(input.runId);
  if (input.kind === 'conversation' && conversationId) {
    const messageId = safeId(input.messageId);
    return { kind: 'conversation', conversationId, ...(runId ? { runId } : {}), ...(messageId ? { messageId } : {}) };
  }
  const approvalId = safeId(input.approvalId);
  if (input.kind === 'run' && conversationId && runId) return { kind: 'run', conversationId, runId };
  if (input.kind === 'approval' && conversationId && runId && approvalId) return { kind: 'approval', conversationId, runId, approvalId };
  const boardId = safeId(input.boardId);
  const taskId = safeId(input.taskId);
  if (input.kind === 'task' && boardId && taskId) return { kind: 'task', boardId, taskId };
  return undefined;
}

function safeFeedbackText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function parsePetFeedback(value: unknown): PetFeedback | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Record<string, unknown>;
  if (!isPetState(input.state)) return undefined;
  const label = safeFeedbackText(input.label, 160);
  if (!label) return undefined;
  const detail = safeFeedbackText(input.detail, 160);
  const conversationId = safeFeedbackText(input.conversationId, 256);
  const runId = safeFeedbackText(input.runId, 256);
  const toolName = safeFeedbackText(input.toolName, 96);
  const openTarget = parsePetOpenTarget(input.openTarget);
  return {
    state: input.state,
    label,
    ...(input.kind === 'task_reminder' ? { kind: 'task_reminder' as const } : {}),
    ...(detail ? { detail } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(runId ? { runId } : {}),
    ...(toolName ? { toolName } : {}),
    ...(openTarget ? { openTarget } : {}),
  };
}

contextBridge.exposeInMainWorld('desktopBridge', {
  pet: {
    get: () => ipcRenderer.invoke('pet:get'),
    list: () => ipcRenderer.invoke('pet:list'),
    asset: (petId: string) => ipcRenderer.invoke('pet:asset', petId),
    focusMain: (target?: PetOpenTarget) => ipcRenderer.invoke('pet:focus-main', target),
    beginDrag: (screenX: number, screenY: number) => ipcRenderer.send('pet:drag-start', screenX, screenY),
    dragTo: (screenX: number, screenY: number) => ipcRenderer.send('pet:drag-move', screenX, screenY),
    endDrag: () => ipcRenderer.send('pet:drag-end'),
    onState: (listener: (state: PetState) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: unknown) => { if (isPetState(state)) listener(state); };
      ipcRenderer.on('pet:state', handler);
      return () => ipcRenderer.removeListener('pet:state', handler);
    },
    onFeedback: (listener: (feedback: PetFeedback) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown) => { const feedback = parsePetFeedback(value); if (feedback) listener(feedback); };
      ipcRenderer.on('pet:feedback', handler);
      return () => ipcRenderer.removeListener('pet:feedback', handler);
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
