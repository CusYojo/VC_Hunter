import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { WorkflowExecutionContext, WorkflowStepLineage } from "@/workflows/contract";
import type { WorkflowRecorder } from "@/workflows/runner";

export class SqliteWorkflowRecorder implements WorkflowRecorder {
  constructor(
    private readonly database: DatabaseSync,
    private readonly triggerType: "scheduled_search" | "research_job" | "manual" = "manual",
    private readonly triggerRef: string | null = null,
  ) {}

  startRun(definition: { id: string; version: string }, context: WorkflowExecutionContext, inputHash: string): string {
    const id = randomUUID();
    this.database.prepare(`INSERT INTO workflow_runs
      (id,workflow_id,workflow_version,trigger_type,trigger_ref,status,trace_id,input_hash,started_at)
      VALUES (?,?,?,?,?,'running',?,?,?)`)
      .run(id, definition.id, definition.version, this.triggerType, this.triggerRef, context.traceId, inputHash, context.now);
    return id;
  }

  startStep(runId: string, step: { id: string; version: string }, startedAt: string): string {
    const id = randomUUID();
    this.database.prepare(`INSERT INTO workflow_step_runs
      (id,workflow_run_id,step_id,step_version,status,started_at) VALUES (?,?,?,?,'running',?)`)
      .run(id, runId, step.id, step.version, startedAt);
    return id;
  }

  completeStep(stepRunId: string, lineage: WorkflowStepLineage, finishedAt: string): void {
    assertTransition(this.database.prepare(`UPDATE workflow_step_runs SET status='succeeded',skill_id=?,skill_version=?,prompt_id=?,prompt_version=?,prompt_hash=?,
      provider_id=?,requested_model=?,model=?,provider_request_id=?,input_tokens=?,output_tokens=?,total_tokens=?,latency_ms=?,input_hash=?,output_hash=?,finished_at=? WHERE id=? AND status='running'`)
      .run(
        lineage.skill?.id ?? null, lineage.skill?.version ?? null, lineage.prompt?.id ?? null, lineage.prompt?.version ?? null, lineage.prompt?.hash ?? null,
        lineage.provider ?? null, lineage.requestedModel ?? null, lineage.model ?? null, lineage.providerRequestId ?? null, lineage.usage?.inputTokens ?? null, lineage.usage?.outputTokens ?? null,
        lineage.usage?.totalTokens ?? null, lineage.latencyMs ?? null, lineage.inputHash ?? null, lineage.outputHash ?? null, finishedAt, stepRunId,
      ));
  }

  failStep(stepRunId: string, errorCode: string, finishedAt: string): void {
    assertTransition(this.database.prepare("UPDATE workflow_step_runs SET status='failed',error_code=?,finished_at=? WHERE id=? AND status='running'").run(errorCode, finishedAt, stepRunId));
  }

  completeRun(runId: string, finishedAt: string): void {
    assertTransition(this.database.prepare("UPDATE workflow_runs SET status='succeeded',finished_at=? WHERE id=? AND status='running'").run(finishedAt, runId));
  }

  failRun(runId: string, errorCode: string, finishedAt: string): void {
    assertTransition(this.database.prepare("UPDATE workflow_runs SET status='failed',error_code=?,finished_at=? WHERE id=? AND status='running'").run(errorCode, finishedAt, runId));
  }
}

function assertTransition(result: { changes: number | bigint }): void {
  if (Number(result.changes) !== 1) throw new Error("Workflow run state transition was lost.");
}
