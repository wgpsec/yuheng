import { ShutdownCoordinator, type ShutdownReport } from './shutdown-coordinator';

export class AppContext<TResources> {
  constructor(
    readonly resources: TResources,
    private readonly shutdown: ShutdownCoordinator,
  ) {}

  close(): Promise<ShutdownReport> {
    return this.shutdown.close();
  }
}
