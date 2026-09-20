import { withApiAuth } from "@/security/api-auth";
import { dataResponse, errorResponse } from "@/api/envelope";
import { readAIBody } from "@/ai/workspace-http";
import { activityRepository } from "@/workbench/activity-http";
import { readActivityMultipart } from "@/workbench/activity-create-http";
import { activityDocumentError } from "@/workbench/activity-document-http";
import { MAX_PROJECT_DOCUMENT_BYTES } from "@/workbench/document-policy";
import { getCurrentUser } from "@/workbench/team";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = withApiAuth(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const key = request.headers.get("idempotency-key") ?? "";
  if (!key.trim() || key.length > 200) return errorResponse(request, 400, "IDEMPOTENCY_REQUIRED", "必须提供有效的 Idempotency-Key。");
  try {
    const { id } = await params; const repository = activityRepository(); const actor = getCurrentUser().id;
    if (request.headers.get("content-type")?.startsWith("application/json")) {
      const input = JSON.parse((await readAIBody(request, 32_000)).toString("utf8"));
      return dataResponse(request, repository.referenceDocuments(id, input, actor, key), { status: 201 });
    }
    const form = await readActivityMultipart(request);
    if ([...form.keys()].some(name => name !== "file" && name !== "expectedVersion") || form.getAll("file").length !== 1 || form.getAll("expectedVersion").length !== 1) throw new SyntaxError();
    const file = form.get("file"); const expectedVersion = Number(form.get("expectedVersion"));
    if (!(file instanceof File) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) return errorResponse(request, 400, "SCHEMA_INVALID", "文件或事项版本无效。");
    if (file.size > MAX_PROJECT_DOCUMENT_BYTES) return errorResponse(request, 413, "FILE_TOO_LARGE", "单文件不能超过 20 MB。");
    const activity = repository.uploadDocument(id, { expectedVersion, name: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }, actor, key);
    return dataResponse(request, activity, { status: 201 });
  } catch (error) { return activityDocumentError(request, error, "附件保存失败，请稍后重试。"); }
});
