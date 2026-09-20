import { withApiAuth } from "@/security/api-auth";
import { getDealTimelineRepository } from "@/db/app";
import { handleMarkNotification } from "@/workbench/deal-timeline-http";
import { getCurrentUser } from "@/workbench/team";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleMarkNotification(request, getDealTimelineRepository(), getCurrentUser(), (await params).id);
}

export const PATCH = withApiAuth(handlePATCH);
