import { requireSession } from "@/auth/server";
import { currentUserSchema } from "@/workbench/contracts";
import type { WorkspaceIdentity } from "./identity-scope";

export async function resolveWorkspaceIdentity(headers: Headers): Promise<WorkspaceIdentity | null> {
  const session = await requireSession(headers);
  if (!session) return null;
  const { membership, user } = session;
  // SQLite business data belongs to exactly one workspace per deployment.
  // Never accept a second tenant against this database, even with a valid login.
  if (!process.env.VC_HUNTER_CURRENT_TENANT_ID || membership.tenantId !== process.env.VC_HUNTER_CURRENT_TENANT_ID) return null;
  const roles = membership.roles;
  const canWrite = roles.includes("investment_manager") || roles.includes("org_admin");
  const canResearch = canWrite || roles.includes("researcher");
  return {
    accountId: user.id, tenantId: membership.tenantId, roles,
    user: currentUserSchema.parse({
      id: membership.teamUserId, name: user.name,
      role: roles.includes("org_admin") ? "管理员" : canWrite ? "投资经理" : canResearch ? "研究员" : "只读成员",
      capabilities: [...(canResearch ? ["discover", "research"] : []), ...(canWrite ? ["review", "assign", "knowledge.review"] : [])],
    }),
  };
}
