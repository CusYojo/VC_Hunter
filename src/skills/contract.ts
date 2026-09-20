import { z } from "zod";

/**
 * Agent Skill 平台统一契约。
 *
 * 每个 Skill 都是“稳定 JSON 输入 + 版本化 Prompt 实现 + 稳定 JSON 输出”，
 * 而不是自然语言自由函数。上层可以跨模型调用同一个 Skill，模型升级不改变契约。
 */

export const SKILL_STATUS_VALUES = ["ok", "partial", "blocked", "failed"] as const;
export type SkillStatus = (typeof SKILL_STATUS_VALUES)[number];

export const SKILL_ERROR_CODES = [
  "NO_EVIDENCE",
  "ENTITY_AMBIGUOUS",
  "RATE_LIMITED",
  "AUTH_REQUIRED",
  "ROBOTS_BLOCKED",
  "COMPLIANCE_BLOCKED",
  "SOURCE_CHANGED",
  "SCHEMA_INVALID",
  "MODEL_TIMEOUT",
  "PARTIAL_RESULT",
] as const;
export type SkillErrorCode = (typeof SKILL_ERROR_CODES)[number];

export interface SkillInvocationScope {
  region: string;
  tracks: string[];
  asOf: string;
}

export interface SkillEvidenceRef {
  sourceId: string;
  claimId: string;
  confidence: number;
}

export interface SkillLineage {
  runId: string;
  skillId: string;
  skillVersion: string;
  promptVersion: string;
  modelVersion: string;
  provider: string;
}

export interface SkillResult<TData = unknown> {
  status: SkillStatus;
  data: TData;
  evidence: SkillEvidenceRef[];
  confidence: number;
  warnings: string[];
  errors: Array<{ code: SkillErrorCode; message: string }>;
  lineage: SkillLineage;
}

export interface SkillInvocation<TInput = unknown> {
  taskId: string;
  skill: string;
  scope: SkillInvocationScope;
  input: TInput;
  constraints?: {
    sourcePolicy?: string;
    maxSourceAgeDays?: number;
  };
}

export interface SkillDefinition<TInput = unknown, TOutput = unknown> {
  id: string;
  version: string;
  promptVersion: string;
  description: string;
  requiresModel: boolean;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  systemPrompt: string;
}

export function makeError(code: SkillErrorCode, message: string): { code: SkillErrorCode; message: string } {
  return { code, message };
}

export function buildLineage(
  definition: { id: string; version: string; promptVersion: string },
  runId: string,
  provider: string,
  modelVersion: string,
): SkillLineage {
  return {
    runId,
    skillId: definition.id,
    skillVersion: definition.version,
    promptVersion: definition.promptVersion,
    modelVersion,
    provider,
  };
}
