import { withApiAuth } from "@/security/api-auth";
import { dataResponse } from "@/api/envelope";
import { getCurrentUser } from "@/workbench/team";
import { activityRepository } from "@/workbench/activity-http";
import { activityDocumentError } from "@/workbench/activity-document-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = withApiAuth(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  try { return dataResponse(request, activityRepository().view((await params).id, getCurrentUser().id)); }
  catch (error) { return activityDocumentError(request, error, "审批查看状态更新失败，请稍后重试。"); }
});
