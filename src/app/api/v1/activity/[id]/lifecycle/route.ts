import { withApiAuth } from "@/security/api-auth";
import { dataResponse, errorResponse } from "@/api/envelope";
import { readAIBody } from "@/ai/workspace-http";
import { getCurrentUser } from "@/workbench/team";
import { activityRepository } from "@/workbench/activity-http";
import { activityDocumentError } from "@/workbench/activity-document-http";
import { identityScope } from "@/security/identity-scope";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = withApiAuth(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const body = JSON.parse((await readAIBody(request, 1024)).toString("utf8"));
    return dataResponse(request, activityRepository().lifecycle((await params).id, body, getCurrentUser().id, { canAdmin: identityScope.getStore()?.roles.includes("org_admin") }));
  } catch (error) {
    if (error instanceof RangeError) return errorResponse(request, 413, "PAYLOAD_TOO_LARGE", "请求内容超出大小限制。");
    return activityDocumentError(request, error, "审批状态更新失败，请稍后重试。");
  }
});
