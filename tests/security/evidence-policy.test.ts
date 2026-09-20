import { describe, expect, it } from "vitest";
import { createRequestContext } from "@/security/request-context";
import {
  approveOutboundUse,
  resolveEvidenceForUse,
  type OutboundUseRequest,
} from "@/security/evidence-policy";

const pendingRequest: OutboundUseRequest = {
  id: "request-1",
  tenantId: "tenant-1",
  projectId: "project-1",
  documentId: "document-1",
  requesterMembershipId: "member-requester",
  jobId: "job-1",
  provider: "deepseek",
  model: "deepseek-chat",
  purpose: "project-document-analysis@1.1.0",
  status: "pending",
  approvedByMembershipId: null,
  approvedAt: null,
};

function context(membershipId: string, roles: Array<"researcher" | "compliance_reviewer">) {
  return createRequestContext({
    userId: `user-${membershipId}`,
    sessionId: `session-${membershipId}`,
    emailVerified: true,
    twoFactorEnabled: true,
    sessionTwoFactorVerified: true,
    membershipActive: true,
    membershipId,
    tenantId: "tenant-1",
    roles,
  });
}

describe("outbound evidence policy", () => {
  it("requires a different compliance reviewer in the same tenant", () => {
    expect(() => approveOutboundUse(pendingRequest, context("member-requester", ["compliance_reviewer"]), "2026-09-02T01:00:00.000Z"))
      .toThrow(/self-approve/i);
    expect(() => approveOutboundUse(pendingRequest, context("member-other", ["researcher"]), "2026-09-02T01:00:00.000Z"))
      .toThrow(/outbound\.review/i);
    expect(() => approveOutboundUse(pendingRequest, createRequestContext({
      userId: "user-reviewer",
      sessionId: "session-reviewer",
      emailVerified: true,
      twoFactorEnabled: true,
      sessionTwoFactorVerified: true,
      membershipActive: true,
      membershipId: "member-reviewer",
      tenantId: "tenant-2",
      roles: ["compliance_reviewer"],
    }), "2026-09-02T01:00:00.000Z")).toThrow(/tenant/i);
  });

  it("returns a new immutable approval without changing the pending request", () => {
    const approved = approveOutboundUse(
      pendingRequest,
      context("member-reviewer", ["compliance_reviewer"]),
      "2026-09-02T01:00:00.000Z",
    );

    expect(approved).not.toBe(pendingRequest);
    expect(pendingRequest.status).toBe("pending");
    expect(approved).toMatchObject({
      status: "approved",
      approvedByMembershipId: "member-reviewer",
      approvedAt: "2026-09-02T01:00:00.000Z",
    });
  });

  it("requires an exact timestamp and fails closed for unknown classifications", () => {
    expect(() => approveOutboundUse(
      pendingRequest,
      context("member-reviewer", ["compliance_reviewer"]),
      "2026-09-02",
    )).toThrow(/ISO timestamp/i);

    const approval = approveOutboundUse(
      pendingRequest,
      context("member-reviewer", ["compliance_reviewer"]),
      "2026-09-02T01:00:00.000Z",
    );
    expect(resolveEvidenceForUse({
      scope: {
        tenantId: "tenant-1", projectId: "project-1", documentId: "document-1",
        jobId: "job-1", provider: "deepseek", model: "deepseek-chat",
        purpose: "project-document-analysis@1.1.0",
      },
      evidence: {
        tenantId: "tenant-1", projectId: "project-1", documentId: "document-1",
        classification: "unknown" as "internal", sourceAllowsExternal: true,
      },
      approval,
      providerEnabled: true,
      remainingBudgetCents: 100,
      estimatedCostCents: 20,
    })).toEqual({ allowed: false, reason: "classification_blocked" });
  });

  it("fails closed unless tenant, project, document, job, provider, model and purpose all match", () => {
    const approval = approveOutboundUse(
      pendingRequest,
      context("member-reviewer", ["compliance_reviewer"]),
      "2026-09-02T01:00:00.000Z",
    );
    const common = {
      scope: {
        tenantId: "tenant-1",
        projectId: "project-1",
        documentId: "document-1",
        jobId: "job-1",
        provider: "deepseek",
        model: "deepseek-chat",
        purpose: "project-document-analysis@1.1.0",
      },
      evidence: {
        tenantId: "tenant-1",
        projectId: "project-1",
        documentId: "document-1",
        classification: "internal" as const,
        sourceAllowsExternal: true,
      },
      approval,
      providerEnabled: true,
      remainingBudgetCents: 100,
      estimatedCostCents: 20,
    };

    expect(resolveEvidenceForUse(common)).toEqual({ allowed: true });
    for (const [field, value] of [
      ["tenantId", "tenant-2"],
      ["projectId", "project-2"],
      ["documentId", "document-2"],
      ["jobId", "job-2"],
      ["provider", "other-provider"],
      ["model", "other-model"],
      ["purpose", "project-research@1.2.0"],
    ] as const) {
      const scope = { ...common.scope, [field]: value };
      const evidence = field === "tenantId" || field === "projectId" || field === "documentId"
        ? { ...common.evidence, [field]: value }
        : common.evidence;
      expect(resolveEvidenceForUse({ ...common, scope, evidence }), field)
        .toEqual({ allowed: false, reason: "approval_scope_mismatch" });
    }
    expect(resolveEvidenceForUse({ ...common, evidence: { ...common.evidence, documentId: "document-2" } }))
      .toEqual({ allowed: false, reason: "evidence_scope_mismatch" });
  });

  it("applies deny-wins for source policy, classification, provider and budget", () => {
    const approval = approveOutboundUse(
      pendingRequest,
      context("member-reviewer", ["compliance_reviewer"]),
      "2026-09-02T01:00:00.000Z",
    );
    const common = {
      scope: {
        tenantId: "tenant-1",
        projectId: "project-1",
        documentId: "document-1",
        jobId: "job-1",
        provider: "deepseek",
        model: "deepseek-chat",
        purpose: "project-document-analysis@1.1.0",
      },
      evidence: {
        tenantId: "tenant-1",
        projectId: "project-1",
        documentId: "document-1",
        classification: "internal" as const,
        sourceAllowsExternal: true,
      },
      approval,
      providerEnabled: true,
      remainingBudgetCents: 100,
      estimatedCostCents: 20,
    };

    expect(resolveEvidenceForUse({ ...common, evidence: { ...common.evidence, sourceAllowsExternal: false } }))
      .toEqual({ allowed: false, reason: "source_policy_blocked" });
    expect(resolveEvidenceForUse({ ...common, evidence: { ...common.evidence, classification: "restricted" } }))
      .toEqual({ allowed: false, reason: "classification_blocked" });
    expect(resolveEvidenceForUse({ ...common, providerEnabled: false }))
      .toEqual({ allowed: false, reason: "provider_disabled" });
    expect(resolveEvidenceForUse({ ...common, remainingBudgetCents: 0 }))
      .toEqual({ allowed: false, reason: "budget_exhausted" });
    expect(resolveEvidenceForUse({ ...common, remainingBudgetCents: 10, estimatedCostCents: 20 }))
      .toEqual({ allowed: false, reason: "budget_exhausted" });
    expect(resolveEvidenceForUse({ ...common, approval: null }))
      .toEqual({ allowed: false, reason: "approval_required" });
    expect(resolveEvidenceForUse({
      ...common,
      approval: { ...approval, approvedByMembershipId: null, approvedAt: null },
    })).toEqual({ allowed: false, reason: "approval_not_active" });
  });
});
