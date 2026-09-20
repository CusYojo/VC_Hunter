import { withApiAuth } from "@/security/api-auth";
import { getDealTimelineRepository } from "@/db/app";
import { handleAddAttachment } from "@/workbench/deal-timeline-http";
import { getCurrentUser } from "@/workbench/team";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(request: Request, { params }: { params: Promise<{ id: string; milestoneId: string }> }) {
  const { id, milestoneId } = await params;
  return handleAddAttachment(request, getDealTimelineRepository(), getCurrentUser(), id, milestoneId);
}

export const POST = withApiAuth(handlePOST);
