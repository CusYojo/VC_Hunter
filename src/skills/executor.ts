import { randomUUID } from "node:crypto";
import type { ModelGateway } from "@/connectors/model-gateway";
import {
  buildLineage,
  makeError,
  type SkillDefinition,
  type SkillInvocation,
  type SkillResult,
} from "./contract";
import { SKILL_DEFINITIONS } from "./definitions";
import { SkillRegistry } from "./registry";

export interface SkillExecutorOptions {
  gateway: ModelGateway;
  provider: string;
  modelVersion: string;
  registry?: SkillRegistry;
  skillVersions?: Readonly<Record<string, string>>;
}

/**
 * Skill 执行器：校验输入 → 调用模型（或确定性处理）→ 校验输出 → 包装为统一 SkillResult。
 *
 * 模型输出永远是“分析产物”，不能反向覆盖原始事实；因此这里只做结构校验，
 * 证据回指的合法性由各 skill 的调用方负责复核（与现有 research brief 一致）。
 */
export class SkillExecutor {
  private readonly registry: SkillRegistry;

  constructor(private readonly options: SkillExecutorOptions) {
    this.registry = options.registry ?? createBuiltinSkillRegistry();
  }

  async execute<TInput, TOutput>(skillId: string, invocation: SkillInvocation<TInput>): Promise<SkillResult<TOutput>> {
    const requestedVersion = this.options.skillVersions?.[skillId] ?? "1.0.0";
    const skillModule = this.registry.resolve<TInput, TOutput>(skillId, requestedVersion);
    const definition = skillModule?.definition as SkillDefinition<TInput, TOutput> | undefined;
    if (!definition || !skillModule) {
      return {
        status: "failed",
        data: null as unknown as TOutput,
        evidence: [],
        confidence: 0,
        warnings: [],
        errors: [makeError("SCHEMA_INVALID", `Unknown skill: ${skillId}`)],
        lineage: {
          runId: randomUUID(),
          skillId,
          skillVersion: "unknown",
          promptVersion: "unknown",
          modelVersion: this.options.modelVersion,
          provider: this.options.provider,
        },
      };
    }

    const runId = randomUUID();
    const lineage = buildLineage(definition, runId, this.options.provider, this.options.modelVersion);
    const warnings: string[] = [];

    const parsedInput = definition.inputSchema.safeParse(invocation.input);
    if (!parsedInput.success) {
      return {
        status: "failed",
        data: null as unknown as TOutput,
        evidence: [],
        confidence: 0,
        warnings,
        errors: [makeError("SCHEMA_INVALID", parsedInput.error.message)],
        lineage,
      };
    }

    try {
      const output = skillModule.execute
        ? definition.outputSchema.parse(await skillModule.execute({ runId, provider: this.options.provider, modelVersion: this.options.modelVersion }, parsedInput.data, invocation))
        : await this.executeModelSkill(definition, invocation, parsedInput.data);
      validateEvidenceReferences(skillId, parsedInput.data, output);
      return {
        status: "ok",
        data: output,
        evidence: [],
        confidence: skillModule.execute ? 1 : 0.8,
        warnings,
        errors: [],
        lineage,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const validationFailed = error instanceof SkillOutputValidationError || /invalid|schema|json|parse/i.test(message);
      const code = /timeout|abort/i.test(message) ? "MODEL_TIMEOUT" : validationFailed ? "SCHEMA_INVALID" : "PARTIAL_RESULT";
      return {
        status: "failed",
        data: null as unknown as TOutput,
        evidence: [],
        confidence: 0,
        warnings,
        errors: [makeError(code, error instanceof SkillOutputValidationError ? "Skill output failed deterministic validation." : "Skill execution failed.")],
        lineage,
      };
    }
  }

  private async executeModelSkill<TInput, TOutput>(definition: SkillDefinition<TInput, TOutput>, invocation: SkillInvocation<TInput>, input: TInput): Promise<TOutput> {
    if (!definition.requiresModel) throw new Error("Deterministic skill handler is missing.");
    return this.options.gateway.generateJson({
      system: definition.systemPrompt,
      user: JSON.stringify({ taskId: invocation.taskId, scope: invocation.scope, constraints: invocation.constraints ?? {}, input }),
    }, definition.outputSchema);
  }
}

export function createBuiltinSkillRegistry(): SkillRegistry {
  const registry = new SkillRegistry();
  for (const definition of Object.values(SKILL_DEFINITIONS)) registry.register({ definition: definition as SkillDefinition });
  return registry;
}

class SkillOutputValidationError extends Error {}

function validateEvidenceReferences(skillId: string, input: unknown, output: unknown): void {
  if (!["analyze_project", "build_talent_profile", "write_research_report"].includes(skillId)) return;
  const allowed = new Set<string>();
  collectInputEvidenceIds(input, allowed);
  const referenced = new Set<string>();
  collectOutputEvidenceIds(output, referenced);
  if (Array.from(referenced).some((id) => !allowed.has(id))) throw new SkillOutputValidationError("Unknown evidence reference.");
}

function collectInputEvidenceIds(value: unknown, output: Set<string>): void {
  if (Array.isArray(value)) { for (const item of value) collectInputEvidenceIds(item, output); return; }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (typeof record.id === "string" && typeof record.quote === "string") output.add(record.id);
  if (Array.isArray(record.evidenceIds)) for (const id of record.evidenceIds) if (typeof id === "string") output.add(id);
  for (const child of Object.values(record)) collectInputEvidenceIds(child, output);
}

function collectOutputEvidenceIds(value: unknown, output: Set<string>): void {
  if (Array.isArray(value)) { for (const item of value) collectOutputEvidenceIds(item, output); return; }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.evidenceIds)) for (const id of record.evidenceIds) if (typeof id === "string") output.add(id);
  for (const child of Object.values(record)) collectOutputEvidenceIds(child, output);
}
