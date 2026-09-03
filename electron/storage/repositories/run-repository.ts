import type { RunActivity, RunActivityStatus, RunArtifact, RunStatus, RunSummary, RunUsage } from '../../store';
import { RepositoryBase } from './repository-base';

type Row = Record<string, unknown>;
export type RecoveredRunWorkspace = { runId: string; projectId: string; workspacePath: string | null };

export class RunRepository extends RepositoryBase {

  start(id: string, conversationId: string, inputMessageId: string): void {
    this.db.prepare('INSERT INTO runs (id, conversation_id, input_message_id, status, started_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, conversationId, inputMessageId, 'running', new Date().toISOString());
  }

  finish(id: string, status: Exclude<RunStatus, 'running'>, error?: string, usage?: RunUsage): boolean {
    const now = new Date().toISOString();
    return this.transaction(() => {
      const result = this.db.prepare(`UPDATE runs SET status = ?, error = ?, finished_at = ?, input_tokens = ?, output_tokens = ?, total_tokens = ?, context_tokens = ?, context_window = ?, context_percent = ? WHERE id = ? AND status = 'running'`)
        .run(status, error ?? null, now, usage?.inputTokens ?? null, usage?.outputTokens ?? null, usage?.totalTokens ?? null, usage?.contextTokens ?? null, usage?.contextWindow ?? null, usage?.contextPercent ?? null, id);
      if (Number(result.changes) === 0) return false;
      const activityStatus: RunActivityStatus = status === 'completed' ? 'completed' : status === 'cancelled' || status === 'interrupted' ? 'cancelled' : 'failed';
      this.db.prepare("UPDATE run_activities SET status = ?, finished_at = COALESCE(finished_at, ?) WHERE run_id = ? AND status = 'running'").run(activityStatus, now, id);
      return true;
    });
  }

  recoverRunning(now = new Date().toISOString()): number {
    return this.recoverRunningWorkspaces(now).length;
  }

  recoverRunningWorkspaces(now = new Date().toISOString()): RecoveredRunWorkspace[] {
    return this.transaction(() => {
      const rows = this.db.prepare(`SELECT r.id AS runId, c.project_id AS projectId, COALESCE(c.workspace_path, p.workspace_path) AS workspacePath
        FROM runs r JOIN conversations c ON c.id = r.conversation_id JOIN conversation_projects p ON p.id = c.project_id
        WHERE r.status = 'running'`).all() as Row[];
      this.db.prepare("UPDATE run_activities SET status = 'cancelled', finished_at = COALESCE(finished_at, ?) WHERE status = 'running' AND run_id IN (SELECT id FROM runs WHERE status = 'running')").run(now);
      this.db.prepare("UPDATE runs SET status = 'interrupted', error = ?, finished_at = ? WHERE status = 'running'").run('应用重启时运行被中断。', now);
      return rows.map((row) => ({ runId: String(row.runId), projectId: String(row.projectId), workspacePath: row.workspacePath == null ? null : String(row.workspacePath) }));
    });
  }

  startActivity(runId: string, toolCallId: string, toolName: string, input?: string): void {
    this.db.prepare("INSERT OR REPLACE INTO run_activities (id, run_id, tool_call_id, tool_name, status, input, output, started_at, finished_at) VALUES (?, ?, ?, ?, 'running', ?, NULL, ?, NULL)")
      .run(`${runId}:${toolCallId}`, runId, toolCallId, toolName, input ?? null, new Date().toISOString());
  }

  finishActivity(runId: string, toolCallId: string, toolName: string, isError: boolean, output?: string): void {
    this.db.prepare('UPDATE run_activities SET tool_name = ?, status = ?, output = ?, finished_at = ? WHERE id = ? AND run_id = ?')
      .run(toolName, isError ? 'failed' : 'completed', output ?? null, new Date().toISOString(), `${runId}:${toolCallId}`, runId);
  }

  addArtifact(runId: string, toolCallId: string, artifact: RunArtifact): void {
    this.db.prepare('INSERT INTO run_artifacts (id, run_id, tool_call_id, kind, mime_type, size, url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(artifact.id, runId, toolCallId, artifact.kind, artifact.mimeType, artifact.size, artifact.url, new Date().toISOString());
  }

  deleteArtifactsBefore(cutoff: string): RunArtifact[] {
    return this.transaction(() => {
      const rows = this.db.prepare('SELECT id, kind, mime_type AS mimeType, size, url FROM run_artifacts WHERE created_at < ?').all(cutoff) as Row[];
      this.db.prepare('DELETE FROM run_artifacts WHERE created_at < ?').run(cutoff);
      return rows.map((row) => this.mapArtifact(row));
    });
  }

  listActivities(runId: string): RunActivity[] {
    const rows = this.db.prepare('SELECT tool_call_id AS id, tool_name AS toolName, status, input, output, started_at AS startedAt, finished_at AS finishedAt FROM run_activities WHERE run_id = ? ORDER BY started_at ASC').all(runId) as Row[];
    return rows.map((row) => ({
      id: String(row.id), toolName: String(row.toolName), status: row.status as RunActivityStatus,
      input: row.input == null ? null : String(row.input), output: row.output == null ? null : String(row.output),
      startedAt: String(row.startedAt), finishedAt: row.finishedAt == null ? null : String(row.finishedAt),
      artifacts: this.listArtifacts(runId, String(row.id)),
    }));
  }

  list(conversationId: string): RunSummary[] {
    const rows = this.db.prepare(`SELECT id, conversation_id AS conversationId, status, error, started_at AS startedAt, finished_at AS finishedAt,
      input_message_id AS inputMessageId, input_tokens AS inputTokens, output_tokens AS outputTokens, total_tokens AS totalTokens,
      context_tokens AS contextTokens, context_window AS contextWindow, context_percent AS contextPercent
      FROM runs WHERE conversation_id = ? ORDER BY started_at DESC`).all(conversationId) as Row[];
    return rows.map((row) => ({
      id: String(row.id), conversationId: String(row.conversationId), status: row.status as RunStatus,
      error: row.error == null ? null : String(row.error), startedAt: String(row.startedAt),
      finishedAt: row.finishedAt == null ? null : String(row.finishedAt), inputMessageId: row.inputMessageId == null ? null : String(row.inputMessageId),
      usage: row.totalTokens == null ? null : {
        inputTokens: Number(row.inputTokens), outputTokens: Number(row.outputTokens), totalTokens: Number(row.totalTokens),
        contextTokens: row.contextTokens == null ? null : Number(row.contextTokens), contextWindow: Number(row.contextWindow),
        contextPercent: row.contextPercent == null ? null : Number(row.contextPercent),
      },
      activities: this.listActivities(String(row.id)),
    }));
  }

  private listArtifacts(runId: string, toolCallId: string): RunArtifact[] {
    const rows = this.db.prepare('SELECT id, kind, mime_type AS mimeType, size, url FROM run_artifacts WHERE run_id = ? AND tool_call_id = ? ORDER BY created_at ASC, id ASC').all(runId, toolCallId) as Row[];
    return rows.map((row) => this.mapArtifact(row));
  }

  private mapArtifact(row: Row): RunArtifact {
    return { id: String(row.id), kind: row.kind as RunArtifact['kind'], mimeType: String(row.mimeType), size: Number(row.size), url: String(row.url) };
  }

}
