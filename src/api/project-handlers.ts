import { responsibleInputFields } from "@/workbench/project-responsibles";
import { z } from "zod";
import { filterProjects, TRACKS } from "@/domain/projects";
import { projectStatusForDealStage } from "@/workbench/deal-stages";
import type { SqliteProjectRepository } from "@/repositories/projects";
import { reviewProject } from "@/services/project-review";
import { assignProject } from "@/services/project-assignment";
import { requestEvidence } from "@/services/evidence-request";
import { dataResponse, errorResponse } from "./envelope";

const leadStatusSchema = z.enum(["new", "researching", "contacting", "dd", "ic", "pass", "invested", "exited"]);
const dealStageSchema = z.enum(["contact", "initiation", "dd", "pre_ic", "ic", "closing", "post"]);
const reviewSchema = z.object({
  expectedVersion: z.number().int().positive(),
  status: leadStatusSchema,
  dealStage: dealStageSchema.optional(),
  note: z.string().trim().min(1).max(2_000),
}).strict().superRefine((input, context) => {
  if (input.dealStage && input.status !== projectStatusForDealStage(input.dealStage, input.status)) {
    context.addIssue({ code: "custom", path: ["status"], message: "项目状态与所选推进阶段不一致。" });
  }
});
const assignmentSchema = z.object({
  expectedVersion: z.number().int().positive(),
  ...responsibleInputFields,
}).strict().refine(input => Boolean(input.assignee) !== Boolean(input.assignees), "请选择负责人。");
const evidenceRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  note: z.string().trim().min(8).max(2_000),
}).strict();

export async function handleGetProjects(request: Request, repository: SqliteProjectRepository): Promise<Response> {
  const url = new URL(request.url);
  const trackValue = url.searchParams.get("track");
  const statusValue = url.searchParams.get("status");
  const query = url.searchParams.get("query") ?? undefined;
  const track = trackValue && TRACKS.includes(trackValue as (typeof TRACKS)[number]) ? (trackValue as (typeof TRACKS)[number]) : undefined;
  const statusResult = statusValue ? leadStatusSchema.safeParse(statusValue) : undefined;
  if (statusResult && !statusResult.success) {
    return errorResponse(request, 400, "SCHEMA_INVALID", "无效的项目状态筛选。", statusResult.error.flatten());
  }
  const projects = filterProjects(repository.list(), { track, status: statusResult?.data, query });
  return dataResponse(request, { items: projects, total: projects.length, asOf: "2026-08-30T07:42:00+08:00", demo: true });
}

export async function handleReviewProject(
  request: Request,
  repository: SqliteProjectRepository,
  projectId: string,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(request, 400, "SCHEMA_INVALID", "请求体必须是有效 JSON。");
  }
  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(request, 400, "SCHEMA_INVALID", "人工复核参数无效。", parsed.error.flatten());
  }
  if (!request.headers.get("idempotency-key")) return errorResponse(request, 400, "IDEMPOTENCY_REQUIRED", "必须提供 Idempotency-Key。");
  try {
    const actor = (await import("@/workbench/team")).getCurrentUser();
    const result = reviewProject(repository, { ...parsed.data, reviewer: actor.id, projectId, requestId: request.headers.get("idempotency-key") ?? request.headers.get("x-request-id") ?? crypto.randomUUID() });
    return dataResponse(request, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "人工复核失败。";
    if (/version conflict/i.test(message)) return errorResponse(request, 409, "VERSION_CONFLICT", "项目已被其他操作更新，请刷新后重试。");
    if (/not found/i.test(message)) return errorResponse(request, 404, "NOT_FOUND", "未找到项目。");
    if (/幂等键/.test(message)) return errorResponse(request, 409, "IDEMPOTENCY_CONFLICT", "该幂等键已用于其他项目变更，请使用新的幂等键。");
    if (/clear reason/i.test(message)) return errorResponse(request, 400, "REVIEW_REJECTED", "暂不跟进时请填写明确原因。");
    return errorResponse(request, 400, "REVIEW_REJECTED", "人工复核失败，请检查参数后重试。");
  }
}

export async function handleAssignProject(
  request: Request,
  repository: SqliteProjectRepository,
  projectId: string,
): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse(request, 400, "SCHEMA_INVALID", "请求体必须是有效 JSON。"); }
  const parsed = assignmentSchema.safeParse(body);
  if (!parsed.success) return errorResponse(request, 400, "SCHEMA_INVALID", "项目分配参数无效。", parsed.error.flatten());
  if (!request.headers.get("idempotency-key")) return errorResponse(request, 400, "IDEMPOTENCY_REQUIRED", "必须提供 Idempotency-Key。");
  try {
    const actor = (await import("@/workbench/team")).getCurrentUser();
    const result = assignProject(repository, { ...parsed.data, reviewer: actor.id, projectId, requestId: request.headers.get("idempotency-key") ?? request.headers.get("x-request-id") ?? crypto.randomUUID() });
    return dataResponse(request, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "项目分配失败。";
    if (/version conflict/i.test(message)) return errorResponse(request, 409, "VERSION_CONFLICT", message);
    if (/not found/i.test(message)) return errorResponse(request, 404, "NOT_FOUND", message);
    return errorResponse(request, 400, "ASSIGNMENT_REJECTED", "项目分配失败，请检查参数后重试。");
  }
}

export async function handleEvidenceRequest(
  request: Request,
  repository: SqliteProjectRepository,
  projectId: string,
): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse(request, 400, "SCHEMA_INVALID", "请求体必须是有效 JSON。"); }
  const parsed = evidenceRequestSchema.safeParse(body);
  if (!parsed.success) return errorResponse(request, 400, "SCHEMA_INVALID", "补证请求参数无效。", parsed.error.flatten());
  if (!request.headers.get("idempotency-key")) return errorResponse(request, 400, "IDEMPOTENCY_REQUIRED", "必须提供 Idempotency-Key。");
  try {
    const actor = (await import("@/workbench/team")).getCurrentUser();
    const result = requestEvidence(repository, { ...parsed.data, reviewer: actor.id, projectId, requestId: request.headers.get("idempotency-key") ?? request.headers.get("x-request-id") ?? crypto.randomUUID() });
    return dataResponse(request, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "补证请求失败。";
    if (/version conflict/i.test(message)) return errorResponse(request, 409, "VERSION_CONFLICT", message);
    if (/not found/i.test(message)) return errorResponse(request, 404, "NOT_FOUND", message);
    return errorResponse(request, 400, "EVIDENCE_REQUEST_REJECTED", "补证请求失败，请检查参数后重试。");
  }
}
