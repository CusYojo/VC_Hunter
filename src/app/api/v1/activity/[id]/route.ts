import { withApiAuth } from "@/security/api-auth";
import { errorResponse } from "@/api/envelope";
import { getCurrentUser } from "@/workbench/team";
import { activityRepository, activityWrite } from "@/workbench/activity-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const PATCH = withApiAuth(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const repository = activityRepository();
  const user = getCurrentUser();
  const item = repository.list(user.id, { activityId: id }).find((record) => record.id === id);
  if (!item) return errorResponse(request, 404, "NOT_FOUND", "事项不存在。");
  return activityWrite(request, (body) => repository.respond(id, body, user.id));
});
