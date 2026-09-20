import { z } from "zod";
import { dataResponse, errorResponse } from "@/api/envelope";
import { getAppDatabase } from "@/db/app";
import { identityScope } from "@/security/identity-scope";
import { createPersonalModelGateway, PersonalAIRequiredError } from "./personal-model";
import { createAIRun, deleteAITemplate, listAIRuns, listAITemplates, saveAITemplate } from "./workspace";

export async function readAIBody(request: Request, limit = 300000) {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); throw new RangeError(); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
const WORKSPACE_CONFLICT_MESSAGES = new Set([
  "必须提供有效幂等键。", "幂等键已用于其他请求。", "Agent 配置不存在。",
  "已有 AI 任务执行中，请稍后重试。", "Agent 不存在或版本已更新，请刷新。",
  "最多保存 50 个个人 Agent。",
]);
export function aiWorkspaceError(request: Request, error: unknown) {
  if (error instanceof PersonalAIRequiredError) return errorResponse(request, 409, error.code, error.message);
  if (error instanceof RangeError) return errorResponse(request, 413, "PAYLOAD_TOO_LARGE", "输入资料过大，请缩短后重试。");
  if (error instanceof z.ZodError || error instanceof SyntaxError) return errorResponse(request, 400, "INVALID_INPUT", "请检查输入，并确认同意将本次内容发送至所选模型服务商。");
  if (error instanceof Error && WORKSPACE_CONFLICT_MESSAGES.has(error.message)) return errorResponse(request, 409, "CONFLICT", error.message);
  return errorResponse(request, 502, "AI_REQUEST_FAILED", "模型调用失败，请检查个人 API 配置、额度和服务商可用性。");
}
export async function handleAIRuns(request: Request) {
  const owner = identityScope.getStore();
  if (!owner) return errorResponse(request, 401, "AUTH_REQUIRED", "请先登录。");
  try {
    const db = getAppDatabase();
    if (request.method === "GET") return dataResponse(request, listAIRuns(db, owner));
    const body = JSON.parse((await readAIBody(request)).toString("utf8"));
    const result = await createAIRun(db, owner, body, request.headers.get("idempotency-key") ?? "", createPersonalModelGateway(db, owner));
    return dataResponse(request, result);
  } catch (error) { return aiWorkspaceError(request, error); }
}
export async function handleAITemplates(request: Request) {
  const owner = identityScope.getStore();
  if (!owner) return errorResponse(request, 401, "AUTH_REQUIRED", "请先登录。");
  try {
    const db = getAppDatabase();
    if (request.method === "GET") return dataResponse(request, listAITemplates(db, owner));
    const body = JSON.parse((await readAIBody(request, 40000)).toString("utf8"));
    if (request.method === "POST") return dataResponse(request, saveAITemplate(db, owner, body));
    const parsed = z.object({ id: z.string().min(1).max(128), expectedVersion: z.number().int().positive() }).strict().parse(body);
    deleteAITemplate(db, owner, parsed.id, parsed.expectedVersion);
    return dataResponse(request, { deleted: true });
  } catch (error) { return aiWorkspaceError(request, error); }
}
