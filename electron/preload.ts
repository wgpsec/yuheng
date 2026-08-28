import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktopBridge', {
  app: {
    getInfo: () => ipcRenderer.invoke('app:get-info'),
    openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url),
  },
  backup: {
    export: () => ipcRenderer.invoke('backup:export'),
    import: () => ipcRenderer.invoke('backup:import'),
    getConfig: () => ipcRenderer.invoke('backup:get-config'),
    saveConfig: (config: unknown) => ipcRenderer.invoke('backup:save-config', config),
  },
  search: {
    query: (text: string, limit?: number) => ipcRenderer.invoke('search:query', text, limit),
  },
  conversations: {
    list: (includeArchived?: boolean) => ipcRenderer.invoke('conversations:list', includeArchived),
    projects: {
      list: () => ipcRenderer.invoke('conversation-projects:list'),
      create: (name: string) => ipcRenderer.invoke('conversation-projects:create', name),
      rename: (projectId: string, name: string) => ipcRenderer.invoke('conversation-projects:rename', projectId, name),
      delete: (projectId: string) => ipcRenderer.invoke('conversation-projects:delete', projectId),
    },
    messages: (conversationId: string) => ipcRenderer.invoke('conversations:messages', conversationId),
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
  reasoning: {
    get: (conversationId: string) => ipcRenderer.invoke('reasoning:get', conversationId),
    save: (conversationId: string, level: unknown) => ipcRenderer.invoke('reasoning:save', conversationId, level),
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
      delete: (id: string) => ipcRenderer.invoke('tasks:boards:delete', id),
    },
    list: (boardId: string) => ipcRenderer.invoke('tasks:list', boardId),
    takeOpenRequest: () => ipcRenderer.invoke('tasks:open-request:take'),
    types: {
      list: (boardId: string) => ipcRenderer.invoke('tasks:types:list', boardId),
      create: (boardId: string, name: string) => ipcRenderer.invoke('tasks:types:create', boardId, name),
      rename: (id: string, name: string) => ipcRenderer.invoke('tasks:types:rename', id, name),
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
