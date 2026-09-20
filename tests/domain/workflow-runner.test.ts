import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { WorkflowRunner, type WorkflowRecorder } from "@/workflows/runner";

describe("workflow runner", () => {
  it("runs pinned steps in order and records module lineage", async () => {
    const events: string[] = [];
    const recorder: WorkflowRecorder = {
      startRun: vi.fn().mockReturnValue("run-1"),
      startStep: vi.fn((_runId, step) => { events.push(`start:${step.id}`); return `${step.id}-run`; }),
      completeStep: vi.fn((_id, lineage) => events.push(`complete:${lineage.skill?.id ?? "none"}`)),
      failStep: vi.fn(),
      completeRun: vi.fn(),
      failRun: vi.fn(),
    };
    const runner = new WorkflowRunner(recorder);

    const output = await runner.run({
      id: "demo",
      version: "1.0.0",
      inputSchema: z.object({ count: z.number() }),
      outputSchema: z.object({ count: z.number() }),
      createState: (input) => input,
      steps: [
        { id: "one", version: "1.0.0", lineage: { skill: { id: "increment", version: "1.0.0" } }, run: async (_context, state) => ({ count: state.count + 1 }) },
        { id: "two", version: "1.0.0", run: async (_context, state) => ({ count: state.count * 2 }) },
      ],
      output: (state) => state,
    }, { count: 2 }, { traceId: "trace-1", now: "2026-09-01T00:00:00.000Z" });

    expect(output).toEqual({ count: 6 });
    expect(events).toEqual(["start:one", "complete:increment", "start:two", "complete:none"]);
    expect(recorder.completeRun).toHaveBeenCalledWith("run-1", expect.any(String));
  });

  it("short-circuits and records a sanitized failure", async () => {
    const recorder: WorkflowRecorder = {
      startRun: vi.fn().mockReturnValue("run-2"), startStep: vi.fn().mockReturnValue("step-run"),
      completeStep: vi.fn(), failStep: vi.fn(), completeRun: vi.fn(), failRun: vi.fn(),
    };
    const runner = new WorkflowRunner(recorder);
    const definition = {
      id: "broken", version: "1.0.0", inputSchema: z.object({ value: z.string() }), outputSchema: z.object({ value: z.string() }),
      createState: (input: { value: string }) => input,
      steps: [{ id: "explode", version: "1.0.0", run: async () => { throw new Error("provider secret payload"); } }],
      output: (state: { value: string }) => state,
    };

    await expect(runner.run(definition, { value: "x" }, { traceId: "trace", now: "2026-09-01T00:00:00.000Z" })).rejects.toThrow("provider secret payload");
    expect(recorder.failStep).toHaveBeenCalledWith("step-run", "WORKFLOW_STEP_FAILED", expect.any(String));
    expect(recorder.failRun).toHaveBeenCalledWith("run-2", "WORKFLOW_FAILED", expect.any(String));
    expect(vi.mocked(recorder.failStep).mock.calls.flat().join(" ")).not.toContain("provider secret payload");
  });
});
