import { withApiAuth } from "@/security/api-auth";
import { dataResponse, errorResponse } from "@/api/envelope";
import { getAppDatabase } from "@/db/app";
import { listProjectDocuments, uploadProjectDocument } from "@/workbench/documents";
import { DOCUMENT_EXTERNAL_DISABLED_MESSAGE, MAX_PROJECT_DOCUMENT_BYTES } from "@/workbench/document-policy";
import { mappedError } from "@/workbench/http";
import { getCurrentUser } from "@/workbench/team";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handleGET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { const { id } = await params; const items = listProjectDocuments(getAppDatabase(), id); return dataResponse(request, { items, total: items.length }); }
  catch (error) { return mappedError(request, error, "DOCUMENT_READ_FAILED", "读取资料失败，请稍后重试。"); }
}
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const key = request.headers.get("idempotency-key") ?? "";
  if (!key.trim()) return errorResponse(request, 400, "IDEMPOTENCY_REQUIRED", "必须提供 Idempotency-Key。");
  let form: FormData;
  try { form = await request.formData(); } catch { return errorResponse(request, 400, "SCHEMA_INVALID", "上传表单无效。"); }
  const file = form.get("file");
  const expectedVersion = Number(form.get("expectedVersion"));
  const requestedPolicy = form.get("externalPolicy");
  if (requestedPolicy !== null && requestedPolicy !== "local_only") return errorResponse(request, 400, "DOCUMENT_REJECTED", DOCUMENT_EXTERNAL_DISABLED_MESSAGE);
  const externalPolicy = "local_only";
  if (!(file instanceof File) || !Number.isInteger(expectedVersion) || expectedVersion < 1) return errorResponse(request, 400, "SCHEMA_INVALID", "文件或项目版本无效。");
  if (file.size > MAX_PROJECT_DOCUMENT_BYTES) return errorResponse(request, 413, "FILE_TOO_LARGE", "单文件不能超过 20 MB。");
  try { const result = await uploadProjectDocument(getAppDatabase(), { projectId: (await params).id, expectedVersion, name: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()), externalPolicy, actorId: getCurrentUser().id, idempotencyKey: key }); const { storageKey, ...document } = result; void storageKey; return dataResponse(request, document, { status: 201 }); }
  catch (error) { return mappedError(request, error, "DOCUMENT_REJECTED", "上传失败，请稍后重试。"); }
}

export const GET = withApiAuth(handleGET);
export const POST = withApiAuth(handlePOST);
