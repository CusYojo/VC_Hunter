import { getAuthService } from "@/auth/server";
import { getAppDatabase } from "@/db/app";
import { identityScope } from "@/security/identity-scope";
import { resolveWorkspaceIdentity } from "@/security/workspace-session";
import { errorResponse } from "@/api/envelope";
import { createOfficeAvatarService } from "./office-avatar-service";
import { handleOfficeAvatarRequest, type OfficeAvatarOperation } from "./office-avatar-http";

export async function officeAvatarRequest(request: Request, operation: OfficeAvatarOperation, id?: string): Promise<Response> {
  const identity = identityScope.getStore() ?? await resolveWorkspaceIdentity(request.headers);
  if (!identity) return errorResponse(request, 401, "AUTH_REQUIRED", "请先登录。");
  const actor = { tenantId: identity.tenantId, accountId: identity.accountId, memberId: identity.user.id, canManage: identity.roles.includes("org_admin") };
  return handleOfficeAvatarRequest(request, createOfficeAvatarService(getAppDatabase(), getAuthService().organization), actor, operation, id);
}
