export type ResourceClose = () => void | Promise<void>;

export type ShutdownError = {
  resource: string;
  error: unknown;
};

export type ShutdownReport = {
  errors: readonly ShutdownError[];
};

type RegisteredResource = {
  name: string;
  close: ResourceClose;
  active: boolean;
};

export class ShutdownCoordinator {
  private readonly resources: RegisteredResource[] = [];
  private state: 'open' | 'closing' | 'closed' = 'open';
  private closeOperation: Promise<ShutdownReport> | undefined;

  register(name: string, close: ResourceClose): () => void {
    if (this.state !== 'open') throw new Error('Cannot register a resource after shutdown has started.');
    const resource: RegisteredResource = { name, close, active: true };
    this.resources.push(resource);
    return () => { resource.active = false; };
  }

  close(): Promise<ShutdownReport> {
    if (this.closeOperation) return this.closeOperation;
    this.state = 'closing';
    this.closeOperation = this.closeResources();
    return this.closeOperation;
  }

  private async closeResources(): Promise<ShutdownReport> {
    const errors: ShutdownError[] = [];
    for (const resource of [...this.resources].reverse()) {
      if (!resource.active) continue;
      resource.active = false;
      try {
        await resource.close();
      } catch (error) {
        errors.push({ resource: resource.name, error });
      }
    }
    this.state = 'closed';
    return { errors };
  }
}
