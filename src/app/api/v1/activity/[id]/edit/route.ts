import { withApiAuth } from "@/security/api-auth";
import { dataResponse, errorResponse } from "@/api/envelope";
import { readAIBody } from "@/ai/workspace-http";
import { getCurrentUser } from "@/workbench/team";
import { activityRepository } from "@/workbench/activity-http";
import { activityDocumentError } from "@/workbench/activity-document-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const PATCH = withApiAuth(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const key = request.headers.get("idempotency-key") ?? "";
  if (!key.trim() || key.length > 200) return errorResponse(request,400,"IDEMPOTENCY_REQUIRED","必须提供有效的 Idempotency-Key。");
  try {
    const { id } = await params;
    const body = JSON.parse((await readAIBody(request,65_536)).toString("utf8"));
    return dataResponse(request,activityRepository().edit(id,body,getCurrentUser().id,key));
  } catch (error) {
    if (error instanceof RangeError) return errorResponse(request,413,"PAYLOAD_TOO_LARGE","事项内容超出大小限制。");
    if (error instanceof Error && error.message === "没有编辑此事项的权限。") return errorResponse(request,403,"FORBIDDEN","只有创建者可以编辑此事项。");
    return activityDocumentError(request,error,"事项编辑失败，请稍后重试。");
  }
});
