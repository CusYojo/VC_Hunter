import { describe, expect, it } from "vitest";
import {
  CAPABILITY_VALUES,
  capabilitiesForRoles,
  type OrganizationRole,
} from "@/security/roles";
import {
  createRequestContext,
  rejectSecurityOverrideHeaders,
} from "@/security/request-context";
import { authorizeProjectAccess } from "@/security/project-access";

const verifiedIdentity = {
  userId: "user-1",
  sessionId: "session-1",
  emailVerified: true,
  twoFactorEnabled: true,
  sessionTwoFactorVerified: true,
  membershipActive: true,
  membershipId: "member-1",
  tenantId: "tenant-1",
  roles: ["researcher"] satisfies OrganizationRole[],
};

describe("request authorization", () => {
  it("keeps an exact, closed capability matrix for all five roles", () => {
    expect(CAPABILITY_VALUES).toHaveLength(17);
    expect(capabilitiesForRoles(["org_admin"])).toEqual([
      "organization.manage", "members.manage", "budget.manage", "sources.manage",
      "project.read", "project.access.manage", "audit.read",
    ]);
    expect(capabilitiesForRoles(["investment_manager"])).toEqual([
      "project.read", "discovery.run", "candidate.review", "project.assign", "project.stage",
      "research.run", "document.upload", "judgment.create", "knowledge.review",
      "outbound.request", "audit.read",
    ]);
    expect(capabilitiesForRoles(["researcher"])).toEqual([
      "project.read", "discovery.run", "research.run", "document.upload",
      "judgment.create", "outbound.request",
    ]);
    expect(capabilitiesForRoles(["compliance_reviewer"])).toEqual(["outbound.review", "audit.read"]);
    expect(capabilitiesForRoles(["viewer"])).toEqual(["project.read"]);
    expect(capabilitiesForRoles(["researcher", "researcher"])).toHaveLength(
      capabilitiesForRoles(["researcher"]).length,
    );
  });

  it.each([
    ["unverified email", { ...verifiedIdentity, emailVerified: false }],
    ["missing TOTP", { ...verifiedIdentity, twoFactorEnabled: false }],
    ["session without TOTP assurance", { ...verifiedIdentity, sessionTwoFactorVerified: false }],
    ["inactive membership", { ...verifiedIdentity, membershipActive: false }],
    ["missing active tenant", { ...verifiedIdentity, tenantId: null }],
    ["missing active membership", { ...verifiedIdentity, membershipId: null }],
  ])("rejects %s", (_label, identity) => {
    expect(() => createRequestContext(identity)).toThrow();
  });

  it("rejects client attempts to choose identity or tenant", () => {
    expect(() => rejectSecurityOverrideHeaders(new Headers({ "x-tenant-id": "tenant-2" })))
      .toThrow(/x-tenant-id/i);
    expect(() => rejectSecurityOverrideHeaders(new Headers({ "x-role": "org_admin" })))
      .toThrow(/x-role/i);
    expect(() => rejectSecurityOverrideHeaders(new Headers({ accept: "application/json" })))
      .not.toThrow();
  });

  it("returns not_found for cross-tenant and inaccessible restricted projects", () => {
    const context = createRequestContext(verifiedIdentity);

    expect(authorizeProjectAccess(context, {
      tenantId: "tenant-2",
      visibility: "tenant",
      ownerMembershipId: null,
      memberIds: [],
    }, "project.read")).toEqual({ allowed: false, reason: "not_found" });

    expect(authorizeProjectAccess(context, {
      tenantId: "tenant-1",
      visibility: "restricted",
      ownerMembershipId: "member-2",
      memberIds: ["member-3"],
    }, "project.read")).toEqual({ allowed: false, reason: "not_found" });
  });

  it("allows restricted access only to owner, explicit member, or org admin", () => {
    const project = {
      tenantId: "tenant-1",
      visibility: "restricted" as const,
      ownerMembershipId: "member-1",
      memberIds: [] as string[],
    };

    expect(authorizeProjectAccess(createRequestContext(verifiedIdentity), project, "project.read"))
      .toEqual({ allowed: true });
    expect(authorizeProjectAccess(createRequestContext({
      ...verifiedIdentity,
      membershipId: "member-admin",
      roles: ["org_admin"],
    }), project, "project.read")).toEqual({ allowed: true });
  });

  it("returns forbidden when the project is visible but the action is not allowed", () => {
    const context = createRequestContext({ ...verifiedIdentity, roles: ["viewer"] });
    expect(authorizeProjectAccess(context, {
      tenantId: "tenant-1",
      visibility: "tenant",
      ownerMembershipId: null,
      memberIds: [],
    }, "project.stage")).toEqual({ allowed: false, reason: "forbidden" });
  });

  it("fails closed for unknown roles and project visibility values", () => {
    expect(() => createRequestContext({ ...verifiedIdentity, roles: ["invented-admin"] }))
      .toThrow(/valid organization role/i);
    const context = createRequestContext(verifiedIdentity);
    expect(authorizeProjectAccess(context, {
      tenantId: "tenant-1",
      visibility: "unknown" as "tenant",
      ownerMembershipId: "member-1",
      memberIds: [],
    }, "project.read")).toEqual({ allowed: false, reason: "not_found" });
  });
});
