import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthService } from "@/auth/server";
import { resolveWorkspaceIdentity } from "@/security/workspace-session";
import { identityScope } from "@/security/identity-scope";
import { handleOrganizationRequest, type OrganizationOperation } from "./http";

export async function requireOrgAdmin() {
  const identity = await resolveWorkspaceIdentity(await headers());
  if (!identity) redirect("/login");
  if (!identity.roles.includes("org_admin")) redirect("/organization");
  const actor = { accountId: identity.accountId, tenantId: identity.tenantId };
  getAuthService().organization.assertAdmin(actor);
  return actor;
}

export async function organizationRequest(request: Request, operation: OrganizationOperation, id?: string) {
  // Even when a developer runs with demo auth disabled, this private directory requires a real session.
  const identity = identityScope.getStore() ?? await resolveWorkspaceIdentity(request.headers);
  const actor = identity ? { accountId: identity.accountId, tenantId: identity.tenantId } : null;
  return handleOrganizationRequest(request, getAuthService().organization, actor, operation, id);
}
