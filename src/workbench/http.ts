import { readAIBody } from "@/ai/workspace-http";
import { dataResponse, errorResponse } from "@/api/envelope";
import type { CurrentUser } from "./contracts";
import { candidateReviewSchema, discoveryJobInputSchema, judgmentInputSchema, knowledgeReviewSchema } from "./contracts";
import type { SqliteWorkbenchRepository } from "./repository";
import { DOCUMENT_EXTERNAL_DISABLED_MESSAGE } from "./document-policy";

export function handleGetSession(request: Request, user: CurrentUser) { return dataResponse(request, { user }); }

export async function handleCreateDiscoveryJob(request: Request, repository: SqliteWorkbenchRepository, user: CurrentUser) {
  const key = request.headers.get("idempotency-key") ?? "";
  if (!key.trim()) return errorResponse(request, 400, "IDEMPOTENCY_REQUIRED", "必须提供 Idempotency-Key。");
  let body: unknown;
  try { body = JSON.parse((await readAIBody(request, 65_536)).toString("utf8")); } catch { return errorResponse(request, 400, "SCHEMA_INVALID", "搜索任务参数无效或请求过大。"); }
  const parsed = discoveryJobInputSchema.safeParse(body);
  if (!parsed.success) return errorResponse(request, 400, "SCHEMA_INVALID", "搜索任务参数无效。", parsed.error.flatten());
  try { return dataResponse(request, repository.createDiscoveryJob(parsed.data, key, user.id), { status: 202 }); }
  catch (error) { return mappedError(request, error, "DISCOVERY_JOB_REJECTED", "创建搜索任务失败。"); }
}

export async function handleReviewCandidate(request: Request, repository: SqliteWorkbenchRepository, user: CurrentUser, candidateId: string) {
  const key = request.headers.get("idempotency-key") ?? "";
  if (!key.trim()) return errorResponse(request, 400, "IDEMPOTENCY_REQUIRED", "必须提供 Idempotency-Key。");
  const parsed = await parseJson(request, candidateReviewSchema);
  if (!parsed.ok) return errorResponse(request, 400, "SCHEMA_INVALID", "候选复核参数无效。", parsed.details);
  try { return dataResponse(request, repository.reviewCandidate(candidateId, parsed.data, key, user.id)); }
  catch (error) { return mappedError(request, error, "CANDIDATE_REVIEW_REJECTED", "候选复核失败。"); }
}

export async function handleRecordJudgment(request: Request, repository: SqliteWorkbenchRepository, user: CurrentUser, projectId: string) {
  const key = request.headers.get("idempotency-key") ?? "";
  if (!key.trim()) return errorResponse(request, 400, "IDEMPOTENCY_REQUIRED", "必须提供 Idempotency-Key。");
  const parsed = await parseJson(request, judgmentInputSchema);
  if (!parsed.ok) return errorResponse(request, 400, "SCHEMA_INVALID", "项目判断参数无效。", parsed.details);
  try { return dataResponse(request, repository.addJudgment(projectId, parsed.data, key, user.id), { status: 201 }); }
  catch (error) { return mappedError(request, error, "JUDGMENT_REJECTED", "记录判断失败。"); }
}

export async function handleReviewKnowledge(request: Request, repository: SqliteWorkbenchRepository, user: CurrentUser, id: string) {
  const key = request.headers.get("idempotency-key") ?? "";
  if (!key.trim()) return errorResponse(request, 400, "IDEMPOTENCY_REQUIRED", "必须提供 Idempotency-Key。");
  const parsed = await parseJson(request, knowledgeReviewSchema);
  if (!parsed.ok) return errorResponse(request, 400, "SCHEMA_INVALID", "知识审核参数无效。", parsed.details);
  try { return dataResponse(request, repository.reviewKnowledge(id, parsed.data, key, user.id)); }
  catch (error) { return mappedError(request, error, "KNOWLEDGE_REVIEW_REJECTED", "知识审核失败。"); }
}

export async function parseJson<T>(request: Request, schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { flatten(): unknown } } }) {
  let body: unknown;
  try { body = await request.json(); } catch { return { ok: false as const, details: "请求体必须是有效 JSON。" }; }
  const parsed = schema.safeParse(body);
  return parsed.success
    ? { ok: true as const, data: parsed.data }
    : { ok: false as const, details: parsed.error.flatten() };
}

// Exact, server-owned messages only: substring matching can expose unknown
// database/storage failures containing words such as “不存在” or “版本冲突”.
const KNOWN_BAD_REQUESTS = new Set([
  "文件不能为空。", "单文件不能超过 20 MB。", "仅支持 PDF、DOCX、TXT 和 Markdown 文件。",
  "文件 MIME 类型与扩展名不匹配。", "PDF 文件头校验失败。", "DOCX 文件头校验失败。",
  "文本文件头包含二进制内容。", DOCUMENT_EXTERNAL_DISABLED_MESSAGE,
  "负责人不是团队成员。", "附件必须提供链接或已上传资料 id。",
  "候选已完成复核。", "只有草稿可以审核。", "写操作必须提供 Idempotency-Key。",
  "请先确认有效的正式项目赛道，原始赛道仍保留在候选详情中。",
  "知识草稿必须关联有效资料、研究报告或 Evidence。",
]);
const KNOWN_NOT_FOUND = new Set([
  "项目不存在。", "推进节点不存在。", "关联资料不存在。", "提醒不存在。",
  "机构不存在。", "候选不存在。", "知识条目不存在。", "幂等请求关联的资料不存在。",
]);
const KNOWN_VERSION_CONFLICTS = new Set([
  "版本冲突：项目已发生变化。", "版本冲突：节点已发生变化。",
  "版本冲突：机构信息已发生变化。", "版本冲突：候选已发生变化。", "版本冲突：知识条目已发生变化。",
]);

export function mappedError(request: Request, error: unknown, code: string, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  if (KNOWN_VERSION_CONFLICTS.has(message)) return errorResponse(request, 409, "VERSION_CONFLICT", message);
  if (KNOWN_NOT_FOUND.has(message)) return errorResponse(request, 404, "NOT_FOUND", message);
  if (message === "机构名称已存在。") return errorResponse(request, 409, "ALREADY_EXISTS", message);
  if (message === "幂等键已用于不同请求。") return errorResponse(request, 409, "IDEMPOTENCY_CONFLICT", message);
  if (KNOWN_BAD_REQUESTS.has(message)) return errorResponse(request, 400, code, message);
  console.error("Unexpected workbench failure", { code, method: request.method, path: new URL(request.url).pathname });
  return errorResponse(request, 500, code, fallback);
}

export function requireIdempotencyHeader(request: Request): string | null {
  const key = request.headers.get("idempotency-key") ?? "";
  return key.trim() ? key : null;
}
