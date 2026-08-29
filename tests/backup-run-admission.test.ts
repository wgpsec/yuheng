import assert from 'node:assert/strict';
import test from 'node:test';
import { BackupRunAdmission } from '../electron/backup-run-admission';

test('blocks new runs for the complete backup operation and releases admission afterwards', async () => {
  let finishBackup!: () => void;
  const backupFinished = new Promise<void>((resolve) => { finishBackup = resolve; });
  const admission = new BackupRunAdmission();

  const exporting = admission.run(async () => backupFinished);
  assert.throws(() => admission.assertRunAllowed(), /备份/);

  finishBackup();
  await exporting;
  assert.doesNotThrow(() => admission.assertRunAllowed());

  await assert.rejects(admission.run(async () => { throw new Error('export failed'); }), /export failed/);
  assert.doesNotThrow(() => admission.assertRunAllowed());
});
