import { withApiAuth } from "@/security/api-auth";
import { getDealTimelineRepository } from "@/db/app";
import { handleListNotifications, handleMarkAllNotificationsRead } from "@/workbench/deal-timeline-http";
import { getCurrentUser } from "@/workbench/team";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function handleGET(request: Request) {
  return handleListNotifications(request, getDealTimelineRepository(), getCurrentUser());
}

export const GET = withApiAuth(handleGET);

function handlePATCH(request: Request) {
  return handleMarkAllNotificationsRead(request, getDealTimelineRepository(), getCurrentUser());
}

export const PATCH = withApiAuth(handlePATCH);
