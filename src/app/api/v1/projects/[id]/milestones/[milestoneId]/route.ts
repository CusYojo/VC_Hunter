import { withApiAuth } from "@/security/api-auth";
import { getDealTimelineRepository } from "@/db/app";
import { handleUpdateMilestone } from "@/workbench/deal-timeline-http";
import { getCurrentUser } from "@/workbench/team";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePATCH(request: Request, { params }: { params: Promise<{ id: string; milestoneId: string }> }) {
  const { id, milestoneId } = await params;
  return handleUpdateMilestone(request, getDealTimelineRepository(), getCurrentUser(), id, milestoneId);
}

export const PATCH = withApiAuth(handlePATCH);
