import type { Capability } from "./roles";
import type { RequestContext } from "./request-context";

export interface ProjectAccessRecord {
  readonly tenantId: string;
  readonly visibility: "tenant" | "restricted";
  readonly ownerMembershipId: string | null;
  readonly memberIds: readonly string[];
}

export type AuthorizationDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: "not_found" | "forbidden" };

export function authorizeProjectAccess(
  context: RequestContext,
  project: ProjectAccessRecord,
  capability: Capability,
): AuthorizationDecision {
  if (context.tenantId !== project.tenantId) return { allowed: false, reason: "not_found" };
  if (project.visibility !== "tenant" && project.visibility !== "restricted") {
    return { allowed: false, reason: "not_found" };
  }

  const canSeeRestricted =
    context.roles.includes("org_admin")
    || project.ownerMembershipId === context.membershipId
    || project.memberIds.includes(context.membershipId);
  if (project.visibility === "restricted" && !canSeeRestricted) {
    return { allowed: false, reason: "not_found" };
  }

  if (!context.capabilities.has(capability)) return { allowed: false, reason: "forbidden" };
  return { allowed: true };
}
