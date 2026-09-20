import { z } from "zod";
import { dataResponse, errorResponse } from "@/api/envelope";
import { OrganizationError } from "./contracts";
import { OfficeError, type OfficeActor } from "./office-contracts";
import { AVATAR_MAX_BYTES, createAvatarTemplate } from "./office-avatar";
import { officeAvatarReviewSchema } from "./office-avatar-contracts";
import type { OfficeAvatarService } from "./office-avatar-service";

export type OfficeAvatarOperation = "latest" | "upload" | "template" | "image" | "list" | "review";
const idSchema = z.string().min(1).max(160);
const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
async function readBytes(request: Request, limit: number): Promise<Buffer> {
  const reader = request.body?.getReader();
  if (!reader) throw new OfficeError(400, "SCHEMA_INVALID", "请求内容不能为空。");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new OfficeError(413, "PAYLOAD_TOO_LARGE", "请求内容超过限制。"); }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally { reader.releaseLock(); }
}
async function readUpload(request: Request): Promise<Uint8Array> {
  const bytes = await readBytes(request, AVATAR_MAX_BYTES + 16_384);
  let form: FormData;
  try { form = await new Request(request.url, { method: "POST", headers: request.headers, body: new Uint8Array(bytes) }).formData(); }
  catch { throw new OfficeError(400, "SCHEMA_INVALID", "请使用文件上传表单提交头像。"); }
  const entries = [...form.entries()]; const file = form.get("file");
  if (entries.length !== 1 || !(file instanceof File) || file.type !== "image/png") throw new OfficeError(400, "INVALID_AVATAR", "请上传一个 PNG 文件，不支持指定其他成员。");
  if (file.size > AVATAR_MAX_BYTES) throw new OfficeError(413, "AVATAR_TOO_LARGE", "头像不能超过 256 KB。");
  return new Uint8Array(await file.arrayBuffer());
}
function requestKey(request: Request): string | undefined {
  const value = request.headers.get("idempotency-key");
  return value === null ? undefined : z.string().trim().min(1).max(160).parse(value);
}

export async function handleOfficeAvatarRequest(request: Request, service: OfficeAvatarService, actor: OfficeActor | null, operation: OfficeAvatarOperation, id?: string): Promise<Response> {
  try {
    if (!actor) return errorResponse(request, 401, "AUTH_REQUIRED", "请先登录。");
    if (operation === "image") {
      return new Response(new Uint8Array(service.read(actor, idSchema.parse(id))), { headers: { ...privateHeaders, "Content-Type": "image/png" } });
    }
    if (operation === "template") {
      service.latest(actor);
      return new Response(new Uint8Array(await createAvatarTemplate()), { headers: { ...privateHeaders, "Content-Type": "image/png", "Content-Disposition": 'attachment; filename="vc-hunter-avatar-32x48.png"' } });
    }
    if (operation === "latest") return dataResponse(request, { item: service.latest(actor) }, { headers: privateHeaders });
    if (operation === "list") return dataResponse(request, { items: service.list(actor) }, { headers: privateHeaders });
    const key = requestKey(request);
    if (operation === "upload") return dataResponse(request, await service.submit(actor, await readUpload(request), key), { status: 201, headers: privateHeaders });
    const body = officeAvatarReviewSchema.parse(JSON.parse((await readBytes(request, 8192)).toString("utf8")));
    return dataResponse(request, service.review(actor, idSchema.parse(id), body, key), { headers: privateHeaders });
  } catch (error) {
    if (error instanceof OfficeError || error instanceof OrganizationError) return errorResponse(request, error.status, error.code, error.message);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return errorResponse(request, 400, "SCHEMA_INVALID", "输入格式不正确，请检查 PNG 文件及审核信息。");
    return errorResponse(request, 500, "INTERNAL_ERROR", "头像服务暂时不可用，请稍后重试。");
  }
}
