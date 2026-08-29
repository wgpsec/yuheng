export class BackupRunAdmission {
  private active = false;

  assertRunAllowed(): void {
    if (this.active) throw new Error('备份正在进行，请稍后再启动任务。');
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active) throw new Error('备份正在进行，请稍后再试。');
    this.active = true;
    try {
      return await operation();
    } finally {
      this.active = false;
    }
  }
}
