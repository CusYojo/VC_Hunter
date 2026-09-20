import { withApiAuth } from "@/security/api-auth";
import { dataResponse, errorResponse } from "@/api/envelope";
import { getAppDatabase } from "@/db/app";
import { addDocumentAnnotation, listDocumentAnnotations, documentAnnotationInputSchema } from "@/workbench/project-document-annotations";
import { currentDocumentActor, projectDocumentError } from "@/workbench/project-document-http";
import { parseJson } from "@/workbench/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; documentId: string }> };
export const GET = withApiAuth(async (request: Request, { params }: Context) => {
  try {
    const { id, documentId } = await params;
    return dataResponse(request, listDocumentAnnotations(getAppDatabase(), id, documentId, currentDocumentActor()));
  } catch (error) { return projectDocumentError(request, error, "读取批注失败，请稍后重试。"); }
});
export const POST = withApiAuth(async (request: Request, { params }: Context) => {
  const parsed = await parseJson(request, documentAnnotationInputSchema);
  if (!parsed.ok) return errorResponse(request, 400, "SCHEMA_INVALID", "请填写有效的批注或审核意见。");
  try {
    const { id, documentId } = await params;
    const result = addDocumentAnnotation(getAppDatabase(), id, documentId, parsed.data, currentDocumentActor(), request.headers.get("idempotency-key") ?? "");
    return dataResponse(request, result, { status: 201 });
  } catch (error) { return projectDocumentError(request, error, "保存批注失败，请稍后重试。"); }
});
