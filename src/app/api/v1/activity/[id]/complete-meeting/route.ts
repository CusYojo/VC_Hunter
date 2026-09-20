import { z } from "zod";
import { withApiAuth } from "@/security/api-auth";
import { identityScope } from "@/security/identity-scope";
import { dataResponse, errorResponse } from "@/api/envelope";
import { readAIBody } from "@/ai/workspace-http";
import { getAppDatabase } from "@/db/app";
import { loadTeamMembers } from "@/workbench/team";
import { completeMeeting, MeetingCompletionError } from "@/workbench/meeting-completion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = withApiAuth(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const identity = identityScope.getStore();
  if (!identity) return errorResponse(request, 401, "AUTH_REQUIRED", "请先登录。");
  try {
    const { id } = await params;
    const body = JSON.parse((await readAIBody(request, 1024)).toString("utf8"));
    return dataResponse(request, completeMeeting(getAppDatabase(), id, body, { memberId: identity.user.id, canManage: identity.roles.includes("org_admin") }, loadTeamMembers().map(member => member.id)));
  } catch (error) {
    if (error instanceof MeetingCompletionError) return errorResponse(request, error.status, error.code, error.message);
    if (error instanceof RangeError) return errorResponse(request, 413, "PAYLOAD_TOO_LARGE", "请求内容超出大小限制。");
    if (error instanceof z.ZodError || error instanceof SyntaxError) return errorResponse(request, 400, "SCHEMA_INVALID", "请提供有效的会议版本。");
    console.error("Meeting completion failed", { type: error instanceof Error ? error.name : "Unknown" });
    return errorResponse(request, 500, "INTERNAL_ERROR", "会议结束失败，请稍后重试。");
  }
});
