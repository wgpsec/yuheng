export type ApprovalRequest = {
  runId: string;
  senderId: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  onRequired(approvalId: string): void;
  onResolved(approvalId: string, approved: boolean): void;
};

type PendingApproval = {
  runId: string;
  senderId: number;
  finish(approved: boolean): void;
};

export class ApprovalCoordinator {
  private readonly pending = new Map<string, PendingApproval>();

  constructor(private readonly createId: () => string = () => crypto.randomUUID()) {}

  request(request: ApprovalRequest): Promise<boolean> {
    if (request.signal?.aborted) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const approvalId = this.createId();
      const onAbort = () => finish(false);
      const timer = setTimeout(() => finish(false), request.timeoutMs ?? 120_000);
      const finish = (approved: boolean) => {
        if (!this.pending.has(approvalId)) return;
        this.pending.delete(approvalId);
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', onAbort);
        request.onResolved(approvalId, approved);
        resolve(approved);
      };
      this.pending.set(approvalId, { runId: request.runId, senderId: request.senderId, finish });
      request.signal?.addEventListener('abort', onAbort, { once: true });
      request.onRequired(approvalId);
    });
  }

  resolve(approvalId: string, senderId: number, approved: boolean): void {
    const approval = this.pending.get(approvalId);
    if (!approval || approval.senderId !== senderId) return;
    approval.finish(approved);
  }

  rejectRun(runId: string): void {
    for (const approval of [...this.pending.values()]) if (approval.runId === runId) approval.finish(false);
  }

  rejectSender(senderId: number): void {
    for (const approval of [...this.pending.values()]) if (approval.senderId === senderId) approval.finish(false);
  }

  close(): void {
    for (const approval of [...this.pending.values()]) approval.finish(false);
  }

  get size(): number {
    return this.pending.size;
  }
}
