import { ApprovalLifecycleError } from "./approval-lifecycle";
import { z } from "zod";
import { dataResponse, errorResponse } from "@/api/envelope";
import { getAppDatabase } from "@/db/app";
import { WorkspaceActivityRepository } from "@/repositories/workspace-activity";
import { getCurrentUser, loadTeamMembers } from "./team";

export function activityRepository() {
  return new WorkspaceActivityRepository(getAppDatabase(), loadTeamMembers().map((member) => member.id));
}

export async function activityWrite(request: Request, operation: (body: unknown) => unknown) {
  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse(request, 400, "SCHEMA_INVALID", "请求体必须为 JSON。"); }
  try { return dataResponse(request, operation(body)); }
  catch (error) {
    if (error instanceof ApprovalLifecycleError) return errorResponse(request, error.status, error.code, error.message);
    if (error instanceof z.ZodError) return errorResponse(request, 400, "SCHEMA_INVALID", "请检查标题、人员、日期及意见。");
    const message = error instanceof Error ? error.message : "";
    if (/权限/.test(message)) return errorResponse(request, 403, "FORBIDDEN", "只有指定接收人可以处理。");
    if (/版本冲突|幂等键已用于/.test(message)) return errorResponse(request, 409, "CONFLICT", "内容已更新，请刷新后重试。");
    if (/^(成员不存在|项目不存在|幂等键无效|审批人不能包含申请人|审批需要指定另一位审核人|操作与事项类型不匹配|该事项已经处理)。$/.test(message)) return errorResponse(request, 400, "INVALID_OPERATION", message);
    console.error("Activity operation failed", { actor: getCurrentUser().id, type: error instanceof Error ? error.name : "Unknown" });
    return errorResponse(request, 500, "INTERNAL_ERROR", "保存失败，请稍后重试。");
  }
}
