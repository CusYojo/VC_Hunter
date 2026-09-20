import { describe, expect, it } from "vitest";
import { createDatabase, initializeDatabase } from "@/db/client";
import { SqliteWorkflowRecorder } from "@/repositories/workflow-runs";

describe("workflow run recorder", () => {
  it("stores hashes and module lineage without storing raw business input", () => {
    const database = createDatabase(":memory:");
    initializeDatabase(database);
    const recorder = new SqliteWorkflowRecorder(database, "scheduled_search", "plan-1");
    const now = "2026-09-01T00:00:00.000Z";
    const runId = recorder.startRun({ id: "project-discovery", version: "1.0.0" }, { traceId: "trace-1", now }, "input-hash");
    const stepId = recorder.startStep(runId, { id: "qualify-leads", version: "1.0.0" }, now);
    recorder.completeStep(stepId, {
      workflow: { id: "project-discovery", version: "1.0.0" }, step: { id: "qualify-leads", version: "1.0.0" },
      skill: { id: "qualify-discovery-leads", version: "1.0.0" }, prompt: { id: "lead-qualification", version: "1.0.0", hash: "prompt-hash" },
      provider: "deepseek", model: "deepseek-v4-flash", inputHash: "step-input", outputHash: "step-output",
    }, now);
    recorder.completeRun(runId, now);

    expect(database.prepare("SELECT status,input_hash,trigger_ref FROM workflow_runs WHERE id=?").get(runId)).toMatchObject({ status: "succeeded", input_hash: "input-hash", trigger_ref: "plan-1" });
    expect(database.prepare("SELECT status,skill_id,prompt_hash,provider_id,model,input_hash,output_hash FROM workflow_step_runs WHERE id=?").get(stepId)).toMatchObject({
      status: "succeeded", skill_id: "qualify-discovery-leads", prompt_hash: "prompt-hash", provider_id: "deepseek", model: "deepseek-v4-flash", input_hash: "step-input", output_hash: "step-output",
    });
    expect(JSON.stringify(database.prepare("SELECT * FROM workflow_step_runs WHERE id=?").get(stepId))).not.toContain("raw business input");
  });
});
