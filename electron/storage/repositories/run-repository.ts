import type { DatabaseConnection } from '../database';

export class RunRepository {
  constructor(private readonly db: DatabaseConnection) {}

  recoverRunning(now = new Date().toISOString()): number {
    const result = this.db.prepare("UPDATE runs SET status = 'interrupted', error = ?, finished_at = ? WHERE status = 'running'").run('应用重启时运行被中断。', now);
    return Number(result.changes);
  }
}
