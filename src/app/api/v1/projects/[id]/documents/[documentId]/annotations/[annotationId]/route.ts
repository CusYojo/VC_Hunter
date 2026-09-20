import { withApiAuth } from "@/security/api-auth";
import { dataResponse } from "@/api/envelope";
import { getAppDatabase } from "@/db/app";
import { deleteDocumentAnnotation } from "@/workbench/project-document-annotations";
import { currentDocumentActor, projectDocumentError } from "@/workbench/project-document-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const DELETE = withApiAuth(async (request: Request, { params }: { params: Promise<{ id: string; documentId: string; annotationId: string }> }) => {
  try {
    const { id, documentId, annotationId } = await params;
    return dataResponse(request, deleteDocumentAnnotation(getAppDatabase(), id, documentId, annotationId, currentDocumentActor()));
  } catch (error) { return projectDocumentError(request, error, "删除评论失败，请稍后重试。"); }
});
