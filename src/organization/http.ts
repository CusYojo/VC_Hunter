import { z } from "zod";
import { dataResponse, errorResponse } from "@/api/envelope";
import { OrganizationError, createDepartmentSchema, updateDepartmentSchema, updateMemberSchema, type OrganizationActor } from "./contracts";
import type { createOrganizationService } from "./service";
export type OrganizationOperation = "directory" | "admin-directory" | "create-department" | "update-department" | "update-member";

async function readBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("Missing JSON");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 32_768) { await reader.cancel(); throw new OrganizationError(413, "PAYLOAD_TOO_LARGE", "请求内容超过限制。"); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { reader.releaseLock(); }
}

export async function handleOrganizationRequest(request: Request, service: ReturnType<typeof createOrganizationService>, actor: OrganizationActor | null, operation: OrganizationOperation, id?: string) {
  try {
    if (!actor) return errorResponse(request, 401, "AUTH_REQUIRED", "请先登录。");
    if (operation !== "directory") service.assertAdmin(actor);
    let data: unknown;
    if (operation === "directory") data = service.publicDirectory(actor.tenantId);
    else if (operation === "admin-directory") data = service.directory(actor.tenantId);
    else if (operation === "create-department") data = service.createDepartment(actor, createDepartmentSchema.parse(await readBody(request)));
    else if (operation === "update-department") data = service.updateDepartment(actor, z.string().min(1).max(128).parse(id), updateDepartmentSchema.parse(await readBody(request)));
    else data = service.updateMember(actor, z.string().min(1).max(128).parse(id), updateMemberSchema.parse(await readBody(request)));
    return dataResponse(request, data, { status: operation === "create-department" ? 201 : 200, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof OrganizationError) return errorResponse(request, error.status, error.code, error.message);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return errorResponse(request, 400, "SCHEMA_INVALID", "输入格式不正确，请检查后重试。");
    return errorResponse(request, 500, "INTERNAL_ERROR", "组织服务暂时不可用。");
  }
}
