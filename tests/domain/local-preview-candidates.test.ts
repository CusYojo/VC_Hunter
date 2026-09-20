import { describe, expect, it } from "vitest";
import { buildLocalPreviewCandidates, mergeLocalPreviewCandidates } from "@/intelligence/local-preview-candidates";

const previewBundle = {
  schemaVersion: "1.0",
  batch: { id: "local-preview-test", createdAt: "2026-09-14T10:40:00+08:00", createdBy: "test", accessClass: "public" },
  items: [{
    externalId: "20260910-unipat-ai", entityType: "company", candidateKind: "new_entity", name: "UniPat AI", track: "AI",
    subtrack: "Agent评测与训练数据基础设施", city: "未披露", signalType: "funding_negotiation", eventDate: "2026-09-10", channel: "manual_codex",
    discoveryReason: "公开报道披露拟议融资。", investmentSummary: "UniPat AI 构建真实任务环境与评测训练数据。", investmentHighlights: ["Environment 与 Verifier 基础设施"], openQuestions: ["融资是否交割？"],
    scores: { technology: 5, team: 4, commercial: 2, signal: 4, evidence: 4 },
    evidence: [{ ref: "unipat-official", title: "UniPat 官网", url: "https://unipat.ai/", observedAt: "2026-09-14T10:40:00+08:00", excerpt: "公开产品资料。", authority: "A", accessClass: "public", collectionMethod: "codex", allowExternalModel: true }],
    assertions: [{ field: "officialWebsite", label: "官方网站", valueStatus: "known", epistemicType: "fact", value: "https://unipat.ai/", confidence: 0.9, evidenceRefs: ["unipat-official"] }],
    relationships: [{ entityType: "person", name: "李宽", relation: "创始人", confidence: 0.75, evidenceRefs: ["unipat-official"] }], contacts: [],
    company: { officialWebsite: "https://unipat.ai/", researchLocations: [], products: ["SaaS-Bench"], coreTechnologies: ["Environment + Verifier"], competitors: ["Scale AI"], fundingHistory: [], mergersAndAcquisitions: [] },
  }],
};

describe("local discovery preview candidates", () => {
  it("exposes the prepared September 10 UniPat record without writing it to the database", () => {
    const candidates = buildLocalPreviewCandidates(previewBundle);
    const unipat = candidates.find((candidate) => candidate.name === "UniPat AI");

    expect(candidates).toHaveLength(1);
    expect(unipat).toMatchObject({
      id: "local-preview:20260910-unipat-ai",
      eventDate: "2026-09-10",
      signalType: "funding_negotiation",
      status: "pending_review",
    });
    expect(unipat?.details.company).toMatchObject({ officialWebsite: "https://unipat.ai/" });
    expect(unipat?.evidence).toHaveLength(1);
  });

  it("prefers an existing database record when the same event is already present", () => {
    const preview = buildLocalPreviewCandidates(previewBundle);
    const unipat = preview.find((candidate) => candidate.name === "UniPat AI")!;
    const persisted = { ...unipat, id: "database-unipat", externalId: unipat.externalId };

    const merged = mergeLocalPreviewCandidates([persisted], preview);

    expect(merged.filter((candidate) => candidate.name === "UniPat AI")).toHaveLength(1);
    expect(merged.find((candidate) => candidate.name === "UniPat AI")?.id).toBe("database-unipat");
  });
});
