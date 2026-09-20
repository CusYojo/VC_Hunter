import type { SkillDefinition, SkillInvocation } from "./contract";
import type { AnalysisResult } from "@/analysis/structured-analysis-gateway";

export interface SkillHandlerContext {
  runId: string;
  provider: string;
  modelVersion: string;
}

export interface SkillModule<TInput = unknown, TOutput = unknown> {
  definition: SkillDefinition<TInput, TOutput>;
  execute?(context: SkillHandlerContext, input: TInput, invocation: SkillInvocation<TInput>): Promise<TOutput>;
  executeWithLineage?(context: SkillHandlerContext, input: TInput): Promise<AnalysisResult<TOutput> | { data: TOutput; lineage?: undefined }>;
}

export class SkillRegistry {
  private readonly modules = new Map<string, SkillModule>();

  register<TInput, TOutput>(module: SkillModule<TInput, TOutput>): this {
    const key = `${module.definition.id}@${module.definition.version}`;
    if (this.modules.has(key)) throw new Error(`Skill is already registered: ${key}`);
    this.modules.set(key, Object.freeze({
      ...module,
      definition: Object.freeze({ ...module.definition }),
    }) as unknown as SkillModule);
    return this;
  }

  resolve<TInput, TOutput>(id: string, version: string): SkillModule<TInput, TOutput> | undefined {
    return this.modules.get(`${id}@${version}`) as SkillModule<TInput, TOutput> | undefined;
  }

  list(): readonly SkillModule[] { return Object.freeze(Array.from(this.modules.values())); }
}
