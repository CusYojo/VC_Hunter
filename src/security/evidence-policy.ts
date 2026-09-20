import type { RequestContext } from "./request-context";

export type DataClassification = "public" | "internal" | "confidential" | "restricted";
export type OutboundUseStatus = "pending" | "approved" | "denied" | "consumed" | "closed";

export interface OutboundUseScope {
  readonly tenantId: string;
  readonly projectId: string;
  readonly documentId: string;
  readonly jobId: string;
  readonly provider: string;
  readonly model: string;
  readonly purpose: string;
}

export interface OutboundUseRequest extends OutboundUseScope {
  readonly id: string;
  readonly requesterMembershipId: string;
  readonly status: OutboundUseStatus;
  readonly approvedByMembershipId: string | null;
  readonly approvedAt: string | null;
}

export interface EvidencePolicyRecord {
  readonly tenantId: string;
  readonly projectId: string;
  readonly documentId: string;
  readonly classification: DataClassification;
  readonly sourceAllowsExternal: boolean;
}

const ALLOWED_CLASSIFICATIONS = new Set<string>(["public", "internal"]);

function isExactIsoTimestamp(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

export type EvidencePolicyDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason:
        | "provider_disabled"
        | "budget_exhausted"
        | "source_policy_blocked"
        | "classification_blocked"
        | "evidence_scope_mismatch"
        | "approval_required"
        | "approval_not_active"
        | "approval_scope_mismatch";
    };

export function approveOutboundUse(
  request: OutboundUseRequest,
  reviewer: RequestContext,
  approvedAt: string,
): OutboundUseRequest {
  if (request.tenantId !== reviewer.tenantId) throw new Error("Reviewer tenant does not match the request tenant.");
  if (!reviewer.capabilities.has("outbound.review")) throw new Error("Capability outbound.review is required.");
  if (request.requesterMembershipId === reviewer.membershipId) throw new Error("A requester cannot self-approve outbound use.");
  if (request.status !== "pending") throw new Error("Only pending outbound use can be approved.");
  if (!isExactIsoTimestamp(approvedAt)) throw new Error("Approval time must be an exact ISO timestamp.");

  return {
    ...request,
    status: "approved",
    approvedByMembershipId: reviewer.membershipId,
    approvedAt,
  };
}

function scopeMatches(left: OutboundUseScope, right: OutboundUseScope): boolean {
  return left.tenantId === right.tenantId
    && left.projectId === right.projectId
    && left.documentId === right.documentId
    && left.jobId === right.jobId
    && left.provider === right.provider
    && left.model === right.model
    && left.purpose === right.purpose;
}

export function resolveEvidenceForUse(input: {
  readonly scope: OutboundUseScope;
  readonly evidence: EvidencePolicyRecord;
  readonly approval: OutboundUseRequest | null;
  readonly providerEnabled: boolean;
  readonly remainingBudgetCents: number;
  readonly estimatedCostCents: number;
}): EvidencePolicyDecision {
  if (!input.providerEnabled) return { allowed: false, reason: "provider_disabled" };
  if (
    !Number.isSafeInteger(input.remainingBudgetCents)
    || !Number.isSafeInteger(input.estimatedCostCents)
    || input.estimatedCostCents <= 0
    || input.remainingBudgetCents < input.estimatedCostCents
  ) return { allowed: false, reason: "budget_exhausted" };
  if (!input.evidence.sourceAllowsExternal) return { allowed: false, reason: "source_policy_blocked" };
  if (!ALLOWED_CLASSIFICATIONS.has(input.evidence.classification)) {
    return { allowed: false, reason: "classification_blocked" };
  }
  if (
    input.evidence.tenantId !== input.scope.tenantId
    || input.evidence.projectId !== input.scope.projectId
    || input.evidence.documentId !== input.scope.documentId
  ) {
    return { allowed: false, reason: "evidence_scope_mismatch" };
  }
  if (!input.approval) return { allowed: false, reason: "approval_required" };
  if (input.approval.status !== "approved") return { allowed: false, reason: "approval_not_active" };
  if (
    !input.approval.approvedByMembershipId?.trim()
    || input.approval.approvedByMembershipId === input.approval.requesterMembershipId
    || !isExactIsoTimestamp(input.approval.approvedAt)
  ) return { allowed: false, reason: "approval_not_active" };
  if (!scopeMatches(input.scope, input.approval)) return { allowed: false, reason: "approval_scope_mismatch" };
  return { allowed: true };
}
