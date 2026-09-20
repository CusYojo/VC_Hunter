import {
  capabilitiesForRoles,
  isOrganizationRole,
  type Capability,
  type OrganizationRole,
} from "./roles";

export interface AuthenticatedIdentity {
  readonly userId: string;
  readonly sessionId: string;
  readonly emailVerified: boolean;
  readonly twoFactorEnabled: boolean;
  readonly sessionTwoFactorVerified: boolean;
  readonly membershipActive: boolean;
  readonly membershipId: string | null;
  readonly tenantId: string | null;
  readonly roles: readonly string[];
}

export interface RequestContext {
  readonly userId: string;
  readonly sessionId: string;
  readonly membershipId: string;
  readonly tenantId: string;
  readonly roles: readonly OrganizationRole[];
  readonly capabilities: ReadonlySet<Capability>;
  readonly twoFactorReady: true;
}

const FORBIDDEN_SECURITY_HEADERS = [
  "x-tenant-id",
  "x-user-id",
  "x-actor-id",
  "x-membership-id",
  "x-role",
  "x-capability",
] as const;

function requireIdentifier(value: string | null, label: string): string {
  if (!value?.trim()) throw new Error(`${label} is required.`);
  return value;
}

export function createRequestContext(identity: AuthenticatedIdentity): RequestContext {
  if (!identity.emailVerified) throw new Error("Verified email is required.");
  if (!identity.twoFactorEnabled) throw new Error("Two-factor authentication is required.");
  if (!identity.sessionTwoFactorVerified) throw new Error("This session has not completed two-factor authentication.");
  if (!identity.membershipActive) throw new Error("The active membership is not valid.");
  if (identity.roles.length === 0 || !identity.roles.every(isOrganizationRole)) {
    throw new Error("A valid organization role is required.");
  }

  const roles = [...new Set(identity.roles)] as OrganizationRole[];
  return {
    userId: requireIdentifier(identity.userId, "User"),
    sessionId: requireIdentifier(identity.sessionId, "Session"),
    membershipId: requireIdentifier(identity.membershipId, "Active membership"),
    tenantId: requireIdentifier(identity.tenantId, "Active tenant"),
    roles,
    capabilities: new Set(capabilitiesForRoles(roles)),
    twoFactorReady: true,
  };
}

export function rejectSecurityOverrideHeaders(headers: Headers): void {
  const header = FORBIDDEN_SECURITY_HEADERS.find((name) => headers.has(name));
  if (header) throw new Error(`Client security override header ${header} is forbidden.`);
}
