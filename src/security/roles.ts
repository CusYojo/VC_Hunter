export const ORGANIZATION_ROLE_VALUES = [
  "org_admin",
  "investment_manager",
  "researcher",
  "compliance_reviewer",
  "viewer",
] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLE_VALUES)[number];

export const CAPABILITY_VALUES = [
  "organization.manage",
  "members.manage",
  "budget.manage",
  "sources.manage",
  "project.read",
  "project.access.manage",
  "discovery.run",
  "candidate.review",
  "project.assign",
  "project.stage",
  "research.run",
  "document.upload",
  "judgment.create",
  "knowledge.review",
  "outbound.request",
  "outbound.review",
  "audit.read",
] as const;

export type Capability = (typeof CAPABILITY_VALUES)[number];

const ROLE_CAPABILITIES: Readonly<Record<OrganizationRole, readonly Capability[]>> = {
  org_admin: [
    "organization.manage",
    "members.manage",
    "budget.manage",
    "sources.manage",
    "project.read",
    "project.access.manage",
    "audit.read",
  ],
  investment_manager: [
    "project.read",
    "discovery.run",
    "candidate.review",
    "project.assign",
    "project.stage",
    "research.run",
    "document.upload",
    "judgment.create",
    "knowledge.review",
    "outbound.request",
    "audit.read",
  ],
  researcher: [
    "project.read",
    "discovery.run",
    "research.run",
    "document.upload",
    "judgment.create",
    "outbound.request",
  ],
  compliance_reviewer: ["outbound.review", "audit.read"],
  viewer: ["project.read"],
};

const ROLE_SET = new Set<string>(ORGANIZATION_ROLE_VALUES);

export function isOrganizationRole(value: string): value is OrganizationRole {
  return ROLE_SET.has(value);
}

export function capabilitiesForRoles(roles: readonly OrganizationRole[]): Capability[] {
  const capabilities = new Set<Capability>();
  for (const role of roles) {
    for (const capability of ROLE_CAPABILITIES[role]) capabilities.add(capability);
  }
  return [...capabilities];
}
