import { contextBridge, ipcRenderer } from 'electron';
import type { PetOpenTarget } from './pet-state';
import type { DesktopPetConfig } from './store';

function parsePetOpenTarget(value: unknown): PetOpenTarget | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Record<string, unknown>;
  const safeId = (candidate: unknown): string | undefined => {
    if (typeof candidate !== 'string') return undefined;
    const trimmed = candidate.trim();
    return trimmed && trimmed.length <= 256 ? trimmed : undefined;
  };
  const conversationId = safeId(input.conversationId);
  if (input.kind === 'conversation' && conversationId) {
    const runId = safeId(input.runId);
    const messageId = safeId(input.messageId);
    return { kind: 'conversation', conversationId, ...(runId ? { runId } : {}), ...(messageId ? { messageId } : {}) };
  }
  const runId = safeId(input.runId);
  if (input.kind === 'run' && conversationId && runId) return { kind: 'run', conversationId, runId };
  const approvalId = safeId(input.approvalId);
  if (input.kind === 'approval' && conversationId && runId && approvalId) return { kind: 'approval', conversationId, runId, approvalId };
  const boardId = safeId(input.boardId);
  const taskId = safeId(input.taskId);
  if (input.kind === 'task' && boardId && taskId) return { kind: 'task', boardId, taskId };
  return undefined;
}

contextBridge.exposeInMainWorld('desktopBridge', {
  app: {
    getInfo: () => ipcRenderer.invoke('app:get-info'),
    openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url),
    onFullscreen: (listener: (fullscreen: boolean) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, fullscreen: unknown) => listener(fullscreen === true);
      ipcRenderer.on('window:fullscreen', handler);
      return () => ipcRenderer.removeListener('window:fullscreen', handler);
    },
  },
  backup: {
    export: () => ipcRenderer.invoke('backup:export'),
    import: () => ipcRenderer.invoke('backup:import'),
    getConfig: () => ipcRenderer.invoke('backup:get-config'),
    saveConfig: (config: unknown) => ipcRenderer.invoke('backup:save-config', config),
  },
  desktopPresence: {
    getConfig: () => ipcRenderer.invoke('desktop-presence:get-config'),
    saveConfig: (config: unknown) => ipcRenderer.invoke('desktop-presence:save-config', config),
  },
  search: {
    query: (text: string, limit?: number) => ipcRenderer.invoke('search:query', text, limit),
  },
  conversations: {
    list: (includeArchived?: boolean) => ipcRenderer.invoke('conversations:list', includeArchived),
    projects: {
      list: () => ipcRenderer.invoke('conversation-projects:list'),
      chooseWorkspace: () => ipcRenderer.invoke('conversation-projects:choose-workspace'),
      create: (name: string, workspacePath?: string | null) => ipcRenderer.invoke('conversation-projects:create', name, workspacePath),
      rename: (projectId: string, name: string) => ipcRenderer.invoke('conversation-projects:rename', projectId, name),
      setWorkspace: (projectId: string, workspacePath: string | null) => ipcRenderer.invoke('conversation-projects:set-workspace', projectId, workspacePath),
      delete: (projectId: string) => ipcRenderer.invoke('conversation-projects:delete', projectId),
    },
    messages: (conversationId: string) => ipcRenderer.invoke('conversations:messages', conversationId),
    branch: (conversationId: string, messageId: string) => ipcRenderer.invoke('conversations:branch', conversationId, messageId),
    create: (title?: string, projectId?: string, providerId?: string, profileId?: 'assistant' | 'analyst' | 'auditor') => ipcRenderer.invoke('conversations:create', title, projectId, providerId, profileId),
    setProvider: (conversationId: string, providerId: string) => ipcRenderer.invoke('conversations:set-provider', conversationId, providerId),
    setProfile: (conversationId: string, profileId: 'assistant' | 'analyst' | 'auditor') => ipcRenderer.invoke('conversations:set-profile', conversationId, profileId),
    rename: (conversationId: string, title: string) => ipcRenderer.invoke('conversations:rename', conversationId, title),
    move: (conversationId: string, projectId: string) => ipcRenderer.invoke('conversations:move', conversationId, projectId),
    archive: (conversationId: string, archived: boolean) => ipcRenderer.invoke('conversations:archive', conversationId, archived),
    pin: (conversationId: string, pinned: boolean) => ipcRenderer.invoke('conversations:pin', conversationId, pinned),
    delete: (conversationId: string) => ipcRenderer.invoke('conversations:delete', conversationId),
    export: (conversationId: string) => ipcRenderer.invoke('conversations:export', conversationId),
    import: () => ipcRenderer.invoke('conversations:import'),
  },
  provider: {
    get: () => ipcRenderer.invoke('provider:get'),
    list: () => ipcRenderer.invoke('provider:list'),
    save: (config: unknown) => ipcRenderer.invoke('provider:save', config),
    delete: (providerId: string) => ipcRenderer.invoke('provider:delete', providerId),
    test: (config: unknown) => ipcRenderer.invoke('provider:test', config),
  },
  browserUse: {
    get: () => ipcRenderer.invoke('browser-use:get'),
    save: (config: unknown) => ipcRenderer.invoke('browser-use:save', config),
  },
  computerUse: {
    get: () => ipcRenderer.invoke('computer-use:get'),
    save: (config: unknown) => ipcRenderer.invoke('computer-use:save', config),
  },
  pet: {
    get: () => ipcRenderer.invoke('pet:get'),
    list: () => ipcRenderer.invoke('pet:list'),
    catalog: () => ipcRenderer.invoke('pet:catalog'),
    asset: (petId: string) => ipcRenderer.invoke('pet:asset', petId),
    import: () => ipcRenderer.invoke('pet:import'),
    delete: (petId: string) => ipcRenderer.invoke('pet:delete', petId),
    reveal: (petId: string) => ipcRenderer.invoke('pet:reveal', petId),
    openFolder: () => ipcRenderer.invoke('pet:open-folder'),
    save: (config: unknown) => ipcRenderer.invoke('pet:save', config),
    focusMain: (target?: PetOpenTarget) => ipcRenderer.invoke('pet:focus-main', target),
    takeOpenTarget: async () => parsePetOpenTarget(await ipcRenderer.invoke('pet:open-target:take')) ?? null,
    beginDrag: (screenX: number, screenY: number) => ipcRenderer.send('pet:drag-start', screenX, screenY),
    dragTo: (screenX: number, screenY: number) => ipcRenderer.send('pet:drag-move', screenX, screenY),
    endDrag: () => ipcRenderer.send('pet:drag-end'),
    onState: (listener: (state: 'idle' | 'thinking' | 'working' | 'attention' | 'error' | 'celebrate') => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: unknown) => {
        if (state === 'idle' || state === 'thinking' || state === 'working' || state === 'attention' || state === 'error' || state === 'celebrate') listener(state);
      };
      ipcRenderer.on('pet:state', handler);
      return () => ipcRenderer.removeListener('pet:state', handler);
    },
    onFeedback: (listener: (feedback: { state: 'idle' | 'thinking' | 'working' | 'attention' | 'error' | 'celebrate'; label: string; detail?: string; conversationId?: string; runId?: string; toolName?: string; openTarget?: PetOpenTarget }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, feedback: unknown) => {
        if (!feedback || typeof feedback !== 'object') return;
        const value = feedback as Record<string, unknown>;
        const states = ['idle', 'thinking', 'working', 'attention', 'error', 'celebrate'] as const;
        if (!states.includes(value.state as typeof states[number]) || typeof value.label !== 'string') return;
        const openTarget = parsePetOpenTarget(value.openTarget);
        listener({
          state: value.state as typeof states[number],
          label: value.label,
          ...(value.kind === 'task_reminder' ? { kind: 'task_reminder' as const } : {}),
          ...(typeof value.detail === 'string' ? { detail: value.detail } : {}),
          ...(typeof value.conversationId === 'string' ? { conversationId: value.conversationId } : {}),
          ...(typeof value.runId === 'string' ? { runId: value.runId } : {}),
          ...(typeof value.toolName === 'string' ? { toolName: value.toolName } : {}),
          ...(openTarget ? { openTarget } : {}),
        });
      };
      ipcRenderer.on('pet:feedback', handler);
      return () => ipcRenderer.removeListener('pet:feedback', handler);
    },
    onOpenTarget: (listener: (target: PetOpenTarget) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, target: unknown) => {
        const parsed = parsePetOpenTarget(target);
        if (parsed) listener(parsed);
      };
      ipcRenderer.on('pet:open-target', handler);
      return () => ipcRenderer.removeListener('pet:open-target', handler);
    },
    onConfig: (listener: (config: DesktopPetConfig) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, config: unknown) => {
        if (config && typeof config === 'object' && typeof (config as Record<string, unknown>).enabled === 'boolean') listener(config as DesktopPetConfig);
      };
      ipcRenderer.on('pet:config', handler);
      return () => ipcRenderer.removeListener('pet:config', handler);
    },
    onOpenSettings: (listener: (section?: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, section: unknown) => listener(typeof section === 'string' ? section : undefined);
      ipcRenderer.on('pet:open-settings', handler);
      return () => ipcRenderer.removeListener('pet:open-settings', handler);
    },
  },
  reasoning: {
    get: (conversationId: string) => ipcRenderer.invoke('reasoning:get', conversationId),
    save: (conversationId: string, level: unknown) => ipcRenderer.invoke('reasoning:save', conversationId, level),
  },
  permissions: {
    get: (conversationId: string) => ipcRenderer.invoke('permissions:get', conversationId),
    save: (conversationId: string, mode: unknown) => ipcRenderer.invoke('permissions:save', conversationId, mode),
  },
  attachments: {
    pick: () => ipcRenderer.invoke('attachments:pick'),
    release: (attachmentIds: string[]) => ipcRenderer.invoke('attachments:release', attachmentIds),
  },
  tasks: {
    boards: {
      list: () => ipcRenderer.invoke('tasks:boards:list'),
      create: (name: string) => ipcRenderer.invoke('tasks:boards:create', name),
      rename: (id: string, name: string) => ipcRenderer.invoke('tasks:boards:rename', id, name),
      reorder: (id: string, targetId: string) => ipcRenderer.invoke('tasks:boards:reorder', id, targetId),
      delete: (id: string, replacementBoardId: string) => ipcRenderer.invoke('tasks:boards:delete', id, replacementBoardId),
    },
    list: (boardId: string) => ipcRenderer.invoke('tasks:list', boardId),
    takeOpenRequest: () => ipcRenderer.invoke('tasks:open-request:take'),
    types: {
      list: (boardId: string) => ipcRenderer.invoke('tasks:types:list', boardId),
      create: (boardId: string, name: string) => ipcRenderer.invoke('tasks:types:create', boardId, name),
      rename: (id: string, name: string) => ipcRenderer.invoke('tasks:types:rename', id, name),
      delete: (id: string) => ipcRenderer.invoke('tasks:types:delete', id),
    },
    create: (boardId: string, input: unknown) => ipcRenderer.invoke('tasks:create', boardId, input),
    update: (id: string, patch: unknown) => ipcRenderer.invoke('tasks:update', id, patch),
    reorder: (id: string, targetId: string) => ipcRenderer.invoke('tasks:reorder', id, targetId),
    moveToBoard: (id: string, boardId: string) => ipcRenderer.invoke('tasks:move-board', id, boardId),
    copyToBoard: (id: string, boardId: string) => ipcRenderer.invoke('tasks:copy-board', id, boardId),
    delete: (id: string) => ipcRenderer.invoke('tasks:delete', id),
    onEvent: (listener: (event: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
      ipcRenderer.on('task:event', handler);
      return () => ipcRenderer.removeListener('task:event', handler);
    },
    assets: {
      import: (input: unknown) => ipcRenderer.invoke('tasks:assets:import', input),
      pick: () => ipcRenderer.invoke('tasks:assets:pick'),
      open: (url: string) => ipcRenderer.invoke('tasks:assets:open', url),
    },
  },
  notes: {
    list: (includeArchived?: boolean) => ipcRenderer.invoke('notes:list', includeArchived),
    get: (id: string) => ipcRenderer.invoke('notes:get', id),
    create: (input?: unknown, parentId?: string | null) => ipcRenderer.invoke('notes:create', input, parentId),
    update: (id: string, patch: unknown) => ipcRenderer.invoke('notes:update', id, patch),
    touch: (id: string) => ipcRenderer.invoke('notes:touch', id),
    moveBlock: (sourceId: string, targetId: string, sourceContent: string, blockMarkdown: string) => ipcRenderer.invoke('notes:move-block', sourceId, targetId, sourceContent, blockMarkdown),
    move: (id: string, parentId: string | null, targetId?: string) => ipcRenderer.invoke('notes:move', id, parentId, targetId),
    delete: (id: string) => ipcRenderer.invoke('notes:delete', id),
    covers: { pick: () => ipcRenderer.invoke('notes:covers:pick') },
    versions: {
      list: (noteId: string) => ipcRenderer.invoke('notes:versions:list', noteId),
      restore: (noteId: string, versionId: string) => ipcRenderer.invoke('notes:versions:restore', noteId, versionId),
    },
  },
  runs: {
    list: (conversationId: string) => ipcRenderer.invoke('runs:list', conversationId),
    start: (conversationId: string, content: string, attachmentIds?: string[], reasoningLevel?: 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') => ipcRenderer.invoke('runs:start', conversationId, content, attachmentIds, reasoningLevel),
    retry: (conversationId: string, inputMessageId: string, content: string, reasoningLevel?: 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') => ipcRenderer.invoke('runs:retry', conversationId, inputMessageId, content, reasoningLevel),
    cancel: (runId: string) => ipcRenderer.invoke('runs:cancel', runId),
    approve: (approvalId: string, approved: boolean) => ipcRenderer.invoke('runs:approve', approvalId, approved),
    onEvent: (listener: (event: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
      ipcRenderer.on('run:event', handler);
      return () => ipcRenderer.removeListener('run:event', handler);
    },
  },
});
