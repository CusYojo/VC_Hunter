import { getAuthService } from "@/auth/server";
import { getAppDatabase } from "@/db/app";
import { identityScope } from "@/security/identity-scope";
import { resolveWorkspaceIdentity } from "@/security/workspace-session";
import { OfficeError, type OfficeActor } from "./office-contracts";
import { OfficeRepository } from "./office-repository";

export async function officeContext(request: Request) {
  const identity = identityScope.getStore() ?? await resolveWorkspaceIdentity(request.headers);
  if (!identity) throw new OfficeError(401, "AUTH_REQUIRED", "请先登录。");
  const organization = getAuthService().organization;
  const directory = organization.directory(identity.tenantId);
  const member = directory.members.find(item => item.id === identity.user.id && item.accountId === identity.accountId && item.active && !item.isPlaceholder);
  if (!member) throw new OfficeError(403, "FORBIDDEN", "当前账号没有有效的员工档案。");
  const canManage = member.roles.includes("org_admin");
  if (canManage) organization.assertAdmin({ tenantId: identity.tenantId, accountId: identity.accountId });
  const actor: OfficeActor = { tenantId: identity.tenantId, accountId: identity.accountId, memberId: member.id, canManage };
  return { actor, directory: { departments: directory.departments, members: directory.members.map(({ id, name, title, departmentId, active, isPlaceholder, version }) => ({ id, name, title, departmentId, active, isPlaceholder, version })) }, repository: new OfficeRepository(getAppDatabase()) };
}
