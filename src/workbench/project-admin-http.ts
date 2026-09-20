import { z } from "zod";
import { dataResponse, errorResponse } from "@/api/envelope";
import { getAppDatabase } from "@/db/app";
import { identityScope } from "@/security/identity-scope";
import { createAdminProject, ProjectAdminError, updateAdminProject } from "./project-admin";

async function readInput(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > 200_000) { await reader.cancel(); throw new ProjectAdminError("项目内容过长，请缩短后提交。", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function handleAdminProject(request: Request, projectId?: string) {
  try {
    const identity = identityScope.getStore();
    if (!identity) return errorResponse(request, 401, "AUTH_REQUIRED", "请先登录。");
    const actor = { id: identity.user.id, tenantId: identity.tenantId, roles: identity.roles };
    if (!actor.roles.includes("org_admin")) throw new ProjectAdminError("仅工作空间管理员可以新建或编辑项目内容。", 403);
    const input = await readInput(request), db = getAppDatabase(), key = request.headers.get("idempotency-key") ?? "";
    const project = projectId ? updateAdminProject(db, actor, projectId, input, key) : createAdminProject(db, actor, input, key);
    return dataResponse(request, project, { status: projectId ? 200 : 201 });
  } catch (error) {
    if (error instanceof ProjectAdminError) return errorResponse(request, error.status, "PROJECT_CHANGE_REJECTED", error.message);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return errorResponse(request, 400, "INVALID_PROJECT", "请检查项目名称、赛道、内容长度和版本。");
    return errorResponse(request, 500, "PROJECT_CHANGE_FAILED", "项目保存失败，请稍后重试。");
  }
}
