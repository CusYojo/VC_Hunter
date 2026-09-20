import { withApiAuth } from "@/security/api-auth";
import { deleteActivityComment } from "@/workbench/activity-comment-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const DELETE = withApiAuth(async (request: Request, { params }: { params: Promise<{ id: string; commentId: string }> }) => {
  const { id, commentId } = await params;
  return deleteActivityComment(request, id, commentId);
});
