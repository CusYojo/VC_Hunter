import { z } from "zod";
import { createActivityRequest } from "@/workbench/activity-create-http";
import { withApiAuth } from "@/security/api-auth";
import { dataResponse, errorResponse } from "@/api/envelope";
import { getCurrentUser } from "@/workbench/team";
import { activityRepository } from "@/workbench/activity-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const querySchema = z.object({ status: z.enum(["all", "current", "archived", "withdrawn"]).default("all"), activity: z.string().trim().min(1).max(128).optional() }).strict();
export const GET = withApiAuth((request: Request) => {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return errorResponse(request, 400, "SCHEMA_INVALID", "事项筛选参数无效。");
  return dataResponse(request, activityRepository().list(getCurrentUser().id, { status: parsed.data.status, activityId: parsed.data.activity }));
});
export const POST = withApiAuth(createActivityRequest);
