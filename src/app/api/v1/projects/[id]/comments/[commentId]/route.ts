import { withApiAuth } from "@/security/api-auth";
import { getDealTimelineRepository } from "@/db/app";
import { handleDeleteComment } from "@/workbench/deal-timeline-http";
import { getCurrentUser } from "@/workbench/team";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const DELETE = withApiAuth(async (request: Request, { params }: { params: Promise<{ id: string; commentId: string }> }) => {
  const { id, commentId } = await params;
  return handleDeleteComment(request, getDealTimelineRepository(), getCurrentUser(), id, commentId);
});
