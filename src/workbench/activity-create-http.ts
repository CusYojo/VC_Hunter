import { dataResponse, errorResponse } from "@/api/envelope";
import { readAIBody } from "@/ai/workspace-http";
import { activityRepository } from "./activity-http";
import { activityDocumentError } from "./activity-document-http";
import { getCurrentUser } from "./team";
import type { ActivityFile } from "./activity-attachment-store";

export async function readActivityMultipart(request: Request) {
  const bytes = await readAIBody(request, 21 * 1024 * 1024);
  return new Response(new Uint8Array(bytes), { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
}
export async function createActivityRequest(request: Request) {
  const key = request.headers.get("idempotency-key") ?? "";
  if (!key.trim() || key.length > 200) return errorResponse(request, 400, "IDEMPOTENCY_REQUIRED", "必须提供有效的 Idempotency-Key。");
  try {
    let body: unknown; let files: ActivityFile[] = [];
    if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
      const form = await readActivityMultipart(request);
      if ([...form.keys()].some(name => name !== "payload" && name !== "files") || form.getAll("payload").length !== 1 || typeof form.get("payload") !== "string") throw new SyntaxError();
      body = JSON.parse(String(form.get("payload")));
      const values = form.getAll("files");
      if (values.length > 10) throw new Error("最多上传 10 个文件。");
      files = await Promise.all(values.map(async file => { if (!(file instanceof File)) throw new SyntaxError(); return { name: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }; }));
    } else body = JSON.parse((await readAIBody(request, 65_536)).toString("utf8"));
    return dataResponse(request, activityRepository().create(body, getCurrentUser().id, key, files), { status: request.headers.get("content-type")?.startsWith("multipart/form-data") ? 201 : 200 });
  } catch (error) { return activityDocumentError(request, error, "事项与附件保存失败，请稍后重试。"); }
}
