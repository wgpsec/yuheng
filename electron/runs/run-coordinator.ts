import type { ToolPermissionMode } from '../permission-mode';

export type ActiveRun = {
  controller: AbortController;
  conversationId: string;
  inputMessageId: string;
  permissionMode: ToolPermissionMode;
  replayUser?: { ordinal: number; content: string };
};

export class RunCoordinator {
  private readonly active = new Map<string, ActiveRun>();

  start(runId: string, run: ActiveRun): void {
    if (this.active.has(runId)) throw new Error('Run is already active.');
    if (this.hasActiveConversation(run.conversationId)) throw new Error('该会话仍在处理中。');
    this.active.set(runId, run);
  }

  get(runId: string): ActiveRun | undefined {
    return this.active.get(runId);
  }

  values(): IterableIterator<ActiveRun> {
    return this.active.values();
  }

  get size(): number {
    return this.active.size;
  }

  hasActiveConversation(conversationId: string): boolean {
    for (const run of this.active.values()) if (run.conversationId === conversationId) return true;
    return false;
  }

  cancel(runId: string): void {
    this.active.get(runId)?.controller.abort();
  }

  cancelAll(): void {
    for (const run of this.active.values()) run.controller.abort();
  }

  finish(runId: string): ActiveRun | undefined {
    const run = this.active.get(runId);
    if (run) this.active.delete(runId);
    return run;
  }

  waitForIdle(timeoutMs: number): Promise<void> {
    if (this.active.size === 0) return Promise.resolve();
    return new Promise((resolve) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (this.active.size === 0 || Date.now() - started >= timeoutMs) {
          clearInterval(timer);
          resolve();
        }
      }, 25);
    });
  }
}
