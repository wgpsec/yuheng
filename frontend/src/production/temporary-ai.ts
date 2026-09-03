export type RunCancellation = {
  request(): Promise<void>;
  bind(runId: string): Promise<void>;
  requested(): boolean;
};

export function createRunCancellation(cancel: (runId: string) => Promise<void>): RunCancellation {
  let runId: string | undefined;
  let requested = false;
  let cancellation: Promise<void> | undefined;

  const request = (): Promise<void> => {
    requested = true;
    if (!runId || cancellation) return cancellation ?? Promise.resolve();
    cancellation = cancel(runId);
    return cancellation;
  };

  return {
    request,
    bind(nextRunId) {
      runId = nextRunId;
      return requested ? request() : Promise.resolve();
    },
    requested: () => requested,
  };
}
