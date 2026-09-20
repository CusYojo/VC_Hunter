import { createHash } from "node:crypto";
import type { WorkflowDefinition, WorkflowExecutionContext, WorkflowStep, WorkflowStepLineage } from "./contract";

export interface WorkflowRecorder {
  startRun(definition: { id: string; version: string }, context: WorkflowExecutionContext, inputHash: string): string;
  startStep(runId: string, step: { id: string; version: string }, startedAt: string): string;
  completeStep(stepRunId: string, lineage: WorkflowStepLineage, finishedAt: string): void;
  failStep(stepRunId: string, errorCode: string, finishedAt: string): void;
  completeRun(runId: string, finishedAt: string): void;
  failRun(runId: string, errorCode: string, finishedAt: string): void;
}

export class NullWorkflowRecorder implements WorkflowRecorder {
  startRun(): string { return crypto.randomUUID(); }
  startStep(): string { return crypto.randomUUID(); }
  completeStep(): void {}
  failStep(): void {}
  completeRun(): void {}
  failRun(): void {}
}

export class WorkflowRunner {
  constructor(private readonly recorder: WorkflowRecorder = new NullWorkflowRecorder()) {}

  async run<TInput, TState, TOutput, TContext extends WorkflowExecutionContext>(
    definition: WorkflowDefinition<TInput, TState, TOutput, TContext>,
    rawInput: TInput,
    context: TContext,
  ): Promise<TOutput> {
    const input = definition.inputSchema.parse(rawInput);
    const runId = this.recorder.startRun(definition, context, hashValue(input));
    try {
      let state = definition.createState(input);
      for (const step of definition.steps) state = await this.runStep(definition, step, state, context, runId);
      const output = definition.outputSchema.parse(definition.output(state));
      this.recorder.completeRun(runId, context.now);
      return output;
    } catch (error) {
      this.recorder.failRun(runId, "WORKFLOW_FAILED", context.now);
      throw error;
    }
  }

  private async runStep<TInput, TState, TOutput, TContext extends WorkflowExecutionContext>(
    definition: WorkflowDefinition<TInput, TState, TOutput, TContext>,
    step: WorkflowStep<TState, TContext>,
    state: TState,
    context: TContext,
    runId: string,
  ): Promise<TState> {
    const stepRunId = this.recorder.startStep(runId, step, context.now);
    try {
      const nextState = await step.run(context, state);
      const dynamicLineage = step.lineageFromState?.(nextState) ?? {};
      this.recorder.completeStep(stepRunId, {
        workflow: { id: definition.id, version: definition.version },
        step: { id: step.id, version: step.version },
        ...step.lineage,
        ...dynamicLineage,
        inputHash: hashValue(state),
        outputHash: hashValue(nextState),
      }, context.now);
      return nextState;
    } catch (error) {
      this.recorder.failStep(stepRunId, "WORKFLOW_STEP_FAILED", context.now);
      throw error;
    }
  }
}

function hashValue(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}
