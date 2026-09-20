import { VersionedRegistry, type ModuleRef, type VersionedModule } from "@/runtime/module-registry";
import type { WorkflowDefinition, WorkflowExecutionContext } from "./contract";

export class WorkflowRegistry {
  private readonly modules = new VersionedRegistry<VersionedModule>();

  register<TInput, TState, TOutput, TContext extends WorkflowExecutionContext>(definition: WorkflowDefinition<TInput, TState, TOutput, TContext>): this {
    this.modules.register(definition);
    return this;
  }

  resolve<TInput, TState, TOutput, TContext extends WorkflowExecutionContext>(ref: ModuleRef): WorkflowDefinition<TInput, TState, TOutput, TContext> {
    return this.modules.resolve(ref) as unknown as WorkflowDefinition<TInput, TState, TOutput, TContext>;
  }

  list(): readonly VersionedModule[] { return this.modules.list(); }
}
