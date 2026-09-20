import {
  candidateBundleSchema,
  computeCompleteness,
  missingResearchFields,
  priorityForCandidate,
} from "./contracts";
import type { IntelligenceCandidateView } from "./repository";
import { discoveryEventIdentity } from "@/workbench/discovery-identity";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const LOCAL_PREVIEW_BUNDLE = "2026-09-14-new-projects-round-2.intelligence.json";

export function loadLocalPreviewCandidates(): IntelligenceCandidateView[] {
  if (process.env.NODE_ENV !== "development") return [];
  const file = join(process.cwd(), "docs", "imports", LOCAL_PREVIEW_BUNDLE);
  return buildLocalPreviewCandidates(JSON.parse(readFileSync(file, "utf8")));
}

export function buildLocalPreviewCandidates(rawBundle: unknown): IntelligenceCandidateView[] {
  const bundle = candidateBundleSchema.parse(rawBundle);
  return bundle.items.map((item) => {
    const completeness = computeCompleteness(item);
    const id = `local-preview:${item.externalId}`;
    const details = item.entityType === "company" ? { company: item.company ?? {} }
      : item.entityType === "person" ? { person: item.person ?? {} }
      : { technology: item.technology ?? {} };
    return {
      id,
      legacyProjectCandidateId: null,
      externalId: item.externalId,
      entityType: item.entityType,
      candidateKind: item.candidateKind,
      name: item.name,
      track: item.track,
      subtrack: item.subtrack ?? null,
      city: item.city ?? null,
      signalType: item.signalType,
      eventDate: item.eventDate,
      channel: item.channel,
      discoveryReason: item.discoveryReason,
      investmentSummary: item.investmentSummary,
      investmentHighlights: [...item.investmentHighlights],
      priority: priorityForCandidate(completeness, item.scores, item.investmentHighlights.length > 0),
      scores: { ...item.scores },
      completeness,
      openQuestions: [...item.openQuestions],
      missingFields: missingResearchFields(item),
      matchedEntityType: null,
      matchedEntityId: null,
      matchConfidence: null,
      matchReason: null,
      status: "pending_review",
      version: 1,
      reviewReason: null,
      promotedEntityId: null,
      details,
      createdAt: bundle.batch.createdAt,
      updatedAt: bundle.batch.createdAt,
      evidence: item.evidence.map((evidence, index) => ({ id: `${id}:evidence:${index}`, ...evidence })),
      assertions: item.assertions.map((assertion, index) => ({ id: `${id}:assertion:${index}`, ...assertion })),
      relationships: item.relationships.map((relationship, index) => ({ id: `${id}:relationship:${index}`, ...relationship })),
      contacts: item.contacts.map((contact, index) => ({ id: `${id}:contact:${index}`, ...contact })),
    } satisfies IntelligenceCandidateView;
  });
}

export function mergeLocalPreviewCandidates(persisted: readonly IntelligenceCandidateView[], preview: readonly IntelligenceCandidateView[]): IntelligenceCandidateView[] {
  const externalIds = new Set(persisted.flatMap((candidate) => candidate.externalId ? [candidate.externalId] : []));
  const eventKeys = new Set(persisted.map((candidate) => discoveryEventIdentity(candidate.name, candidate.eventDate, candidate.signalType)));
  const additions = preview.filter((candidate) => !externalIds.has(candidate.externalId ?? "") && !eventKeys.has(discoveryEventIdentity(candidate.name, candidate.eventDate, candidate.signalType)));
  return [...persisted, ...additions];
}
