import { readAIBody } from "@/ai/workspace-http";
import { identityScope } from "@/security/identity-scope";
import { createPersonalModelGateway, PersonalAIRequiredError } from "@/ai/personal-model";
import { bindJobAIRequester } from "@/ai/job-requesters";
import { withApiAuth } from "@/security/api-auth";
import { z } from "zod";
import { dataResponse, errorResponse } from "@/api/envelope";
import { getAppDatabase } from "@/db/app";
import { SqliteResearchJobRepository } from "@/repositories/research-jobs";
import { createResearchJob } from "@/services/research-jobs";
import { loadRuntimeConfigFile } from "@/runtime/create-agent-runtime";
import { resolve } from "node:path";
import { analysisProfileRegistry } from "@/workbench/analysis-profiles";
import { getCurrentTenantId, getCurrentUser } from "@/workbench/team";
import { rejectSecurityOverrideHeaders } from "@/security/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const legacySchema = z.object({
  projectId: z.string().trim().min(1),
  workflow: z.object({ id: z.literal("project-research"), version: z.literal("1.0.0") }).strict().optional(),
}).strict();
const profiledSchema = z.object({
  projectId: z.string().trim().min(1), profileId: z.string().trim().min(1), skillRefs: z.array(z.string()).max(5).default([]),
  instructions: z.string().trim().max(4_000).default(""), expectedVersion: z.number().int().positive(),
}).strict();
const schema = z.union([legacySchema, profiledSchema]);

async function handlePOST(request: Request) {
  try {
    rejectSecurityOverrideHeaders(request.headers);
  } catch {
    return errorResponse(request, 400, "SECURITY_CONTEXT_OVERRIDE", "禁止由客户端指定身份、租户或角色。");
  }
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  const tenantId = getCurrentTenantId();
  let body: unknown;
  try { body = JSON.parse((await readAIBody(request, 65_536)).toString("utf8")); } catch { return errorResponse(request, 400, "SCHEMA_INVALID", "请求体必须是有效 JSON。"); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorResponse(request, 400, "SCHEMA_INVALID", "研究任务参数无效。", parsed.error.flatten());
  try {
    const runtimeConfig = await loadRuntimeConfigFile(resolve(process.env.VC_HUNTER_RUNTIME_CONFIG ?? "config/runtime.local.json"), Boolean(process.env.VC_HUNTER_RUNTIME_CONFIG));
    let workflow: { id: string; version: string };
    let profile;
    let instructions = "";
    if ("profileId" in parsed.data) {
      workflow = { id: "project-research", version: "1.1.0" };
      const project = getAppDatabase().prepare("SELECT version FROM projects WHERE id=?").get(parsed.data.projectId) as { version: number } | undefined;
      if (!project) return errorResponse(request, 404, "NOT_FOUND", "项目不存在。");
      if (Number(project.version) !== parsed.data.expectedVersion) return errorResponse(request, 409, "VERSION_CONFLICT", "项目已发生变化，请刷新后重试。");
      profile = analysisProfileRegistry.resolve(parsed.data.profileId, parsed.data.skillRefs);
      instructions = parsed.data.instructions;
    } else {
      workflow = parsed.data.workflow ?? runtimeConfig.defaults.researchWorkflow;
    }
    if (workflow.id !== "project-research" || !["1.0.0", "1.1.0"].includes(workflow.version)) return errorResponse(request, 400, "SCHEMA_INVALID", "研究 Workflow 未注册。");
    const actor = getCurrentUser();
    const identity = identityScope.getStore();
    const database = getAppDatabase();
    if (identity) createPersonalModelGateway(database, identity);
    database.exec("BEGIN IMMEDIATE");
    try {
    const job = createResearchJob(new SqliteResearchJobRepository(getAppDatabase()), {
      tenantId, projectId: parsed.data.projectId, idempotencyKey, workflow, requestedBy: identity?.accountId ?? actor.id,
      ...(profile ? { profileId: profile.id, profileVersion: profile.version, skillRefs: profile.skillRefs, instructions } : {}),
    });
    if (identity) bindJobAIRequester(database, "research", job.id, identity);
    database.exec("COMMIT");
    return dataResponse(request, job, { status: 202 });
    } catch (error) { database.exec("ROLLBACK"); throw error; }
  } catch (error) {
    if (error instanceof PersonalAIRequiredError) return errorResponse(request, 409, error.code, error.message);
    const message = error instanceof Error ? error.message : "创建研究任务失败。";
    if (/different payload/i.test(message)) return errorResponse(request, 409, "IDEMPOTENCY_CONFLICT", "该幂等键已用于其他研究任务。");
    if (message === "该项目已有其他成员发起的研究任务。") return errorResponse(request, 409, "RESEARCH_ALREADY_RUNNING", message);
    if (/idempotency key is required/i.test(message)) return errorResponse(request, 400, "IDEMPOTENCY_REQUIRED", "必须提供幂等键。");
    return errorResponse(request, 500, "RESEARCH_JOB_REJECTED", "创建研究任务失败，请稍后重试。");
  }
}

export const POST = withApiAuth(handlePOST);
