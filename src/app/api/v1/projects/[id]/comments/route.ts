import { withApiAuth } from "@/security/api-auth";
import { getDealTimelineRepository } from "@/db/app";
import { handleAddComment, handleListComments } from "@/workbench/deal-timeline-http";
import { getCurrentUser } from "@/workbench/team";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleListComments(request, getDealTimelineRepository(), (await params).id);
}

async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleAddComment(request, getDealTimelineRepository(), getCurrentUser(), (await params).id);
}

export const GET = withApiAuth(handleGET);
export const POST = withApiAuth(handlePOST);
