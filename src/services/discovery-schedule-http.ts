import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { dataResponse, errorResponse } from "@/api/envelope";
import { readAIBody } from "@/ai/workspace-http";
import { identityScope } from "@/security/identity-scope";
import { DiscoveryScheduleConflict, readDiscoverySchedule, updateDiscoverySchedule } from "./discovery-schedule";

export async function handleDiscoverySchedule(request: Request, database: DatabaseSync) {
  const identity = identityScope.getStore();
  if (!identity) return errorResponse(request, 401, "AUTH_REQUIRED", "请先登录。");
  const readOnly = request.method === "GET" || request.method === "HEAD";
  if (!readOnly && !identity.roles.includes("org_admin")) return errorResponse(request, 403, "FORBIDDEN", "只有管理员可以开启或暂停定时发现。");
  try {
    if (readOnly) return dataResponse(request, readDiscoverySchedule(database));
    const body = JSON.parse((await readAIBody(request, 4096)).toString("utf8"));
    return dataResponse(request, updateDiscoverySchedule(database, body, identity.accountId));
  } catch (error) {
    if (error instanceof DiscoveryScheduleConflict) return errorResponse(request, 409, "VERSION_CONFLICT", error.message);
    if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof RangeError) return errorResponse(request, 400, "INVALID_INPUT", "请提供有效的开关状态与版本。");
    return errorResponse(request, 500, "SCHEDULE_FAILED", "定时发现设置暂时无法保存，请刷新后重试。");
  }
}
