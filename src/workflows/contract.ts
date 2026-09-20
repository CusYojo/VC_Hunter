import type { z } from "zod";
import type { ModuleRef, VersionedModule } from "@/runtime/module-registry";

export interface WorkflowExecutionContext {
  traceId: string;
  now: string;
  [key: string]: unknown;
}

export interface WorkflowStepLineage {
  workflow: ModuleRef;
  step: ModuleRef;
  skill?: ModuleRef;
  prompt?: ModuleRef & { hash?: string };
  provider?: string;
  model?: string;
  requestedModel?: string;
  providerRequestId?: string | null;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  latencyMs?: number;
  inputHash?: string;
  outputHash?: string;
}

export interface WorkflowStep<TState, TContext extends WorkflowExecutionContext = WorkflowExecutionContext> extends VersionedModule {
  lineage?: Omit<WorkflowStepLineage, "workflow" | "step">;
  lineageFromState?(state: TState): Omit<WorkflowStepLineage, "workflow" | "step">;
  run(context: TContext, state: TState): Promise<TState>;
}

export interface WorkflowDefinition<TInput, TState, TOutput, TContext extends WorkflowExecutionContext = WorkflowExecutionContext> extends VersionedModule {
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  createState(input: TInput): TState;
  steps: readonly WorkflowStep<TState, TContext>[];
  output(state: TState): TOutput;
}
