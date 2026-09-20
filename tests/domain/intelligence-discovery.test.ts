import { describe, expect, it } from "vitest";
import {
  candidateBundleSchema,
  companyDedupeKeys,
  computeCompleteness,
  defaultDiscoveryPlans,
  intelligenceCandidateInputSchema,
  normalizeScores,
  personDedupeKeys,
  priorityForCandidate,
  technologyDedupeKeys,
} from "@/intelligence/contracts";

const source = {
  ref: "source-1",
  title: "公司官网产品发布",
  url: "https://example.com/news/product",
  publishedAt: "2026-09-12T02:00:00.000Z",
  observedAt: "2026-09-13T01:00:00.000Z",
  excerpt: "公司发布新一代光子计算芯片，并披露首批客户验证进展。",
  authority: "A" as const,
  accessClass: "public" as const,
  collectionMethod: "codex" as const,
  allowExternalModel: true,
};

const candidate = {
  externalId: "codex-company-1",
  entityType: "company" as const,
  candidateKind: "new_entity" as const,
  name: "星河光芯",
  track: "半导体" as const,
  subtrack: "光子芯片",
  city: "上海",
  signalType: "product_launch",
  eventDate: "2026-09-12",
  channel: "venture_tech" as const,
  discoveryReason: "官网披露产品发布和客户验证。",
  investmentSummary: "公司面向数据中心推出新一代光子计算芯片，产品已进入首批客户验证，技术路线兼具带宽和能效优势。投资亮点是核心团队具备量产经验且商业验证开始提速；关键待核问题是良率、客户复购和本轮融资条款尚未披露，需要在后续访谈中核实，并重点验证收入质量、现金消耗速度以及下一阶段扩产所需资金。",
  investmentHighlights: ["量产团队和客户验证形成组合优势"],
  openQuestions: ["芯片良率及客户复购数据是否可验证？"],
  scores: { technology: 5, team: 4, commercial: 4, signal: 5, evidence: 4 },
  evidence: [source],
  assertions: [
    { field: "products", label: "主要产品", valueStatus: "known" as const, epistemicType: "fact" as const, value: ["光子计算芯片"], confidence: 0.92, evidenceRefs: ["source-1"] },
    { field: "coreTechnology", label: "核心技术", valueStatus: "known" as const, epistemicType: "fact" as const, value: "片上光互连", confidence: 0.9, evidenceRefs: ["source-1"] },
    { field: "coreTeam", label: "核心团队", valueStatus: "not_disclosed" as const, epistemicType: "fact" as const, confidence: 0.8, evidenceRefs: ["source-1"] },
    { field: "competitors", label: "竞品", valueStatus: "estimated" as const, epistemicType: "inference" as const, value: ["同类光芯片公司"], confidence: 0.6, evidenceRefs: ["source-1"] },
    { field: "fundingHistory", label: "融资历史", valueStatus: "not_disclosed" as const, epistemicType: "fact" as const, confidence: 0.8, evidenceRefs: ["source-1"] },
    { field: "officialWebsite", label: "官网", valueStatus: "known" as const, epistemicType: "fact" as const, value: "https://example.com", confidence: 1, evidenceRefs: ["source-1"] },
    { field: "contacts", label: "公开工作联系方式", valueStatus: "known" as const, epistemicType: "fact" as const, value: ["bd@example.com"], confidence: 0.8, evidenceRefs: ["source-1"] },
  ],
  relationships: [],
  contacts: [{ type: "work_email" as const, value: "bd@example.com", sourceRef: "source-1", verifiedAt: "2026-09-13T01:00:00.000Z" }],
};

describe("intelligence discovery contracts", () => {
  it("rejects detail objects that do not match the candidate entity type", () => {
    const invalidPerson = { ...candidate, entityType: "person", company: undefined, technology: { normalizedName: "错放技术", definition: "错误详情。", maturity: "unknown", keyMetrics: [], papers: [], patents: [], alternatives: [], competitors: [] } };
    expect(() => intelligenceCandidateInputSchema.parse(invalidPerson)).toThrow();
  });
  it("computes L0/L1/L2 without inventing missing facts", () => {
    expect(computeCompleteness({ ...candidate, evidence: [], assertions: [], investmentSummary: "", investmentHighlights: [], openQuestions: [] })).toBe("L0");
    expect(computeCompleteness({ ...candidate, assertions: [] })).toBe("L0");
    expect(computeCompleteness(candidate)).toBe("L2");
    expect(computeCompleteness({ ...candidate, assertions: candidate.assertions.map((assertion) => assertion.field === "products" ? { ...assertion, valueStatus: "unknown" as const, value: undefined, evidenceRefs: [] } : assertion) })).toBe("L1");
    expect(computeCompleteness({ ...candidate, investmentSummary: "短摘要".repeat(20) })).toBe("L1");
    expect(computeCompleteness({ ...candidate, investmentSummary: "过长摘要".repeat(100) })).toBe("L1");
  });

  it("caps unsupported score dimensions and applies the A/B/C evidence gate", () => {
    const scores = normalizeScores(candidate.scores, { technology: 1, team: 0, commercial: 1, signal: 1, evidence: 1 });
    expect(scores).toEqual({ technology: 5, team: 1, commercial: 4, signal: 5, evidence: 4 });
    expect(priorityForCandidate("L2", scores, true)).toBe("A");
    expect(priorityForCandidate("L1", { ...scores, evidence: 3 }, true)).toBe("B");
    expect(priorityForCandidate("L0", scores, true)).toBe("C");
  });

  it("builds deterministic dedupe keys for companies, people and technologies", () => {
    expect(companyDedupeKeys({ unifiedCreditCode: "91310000MA1ABC", officialWebsite: "https://WWW.Example.com/about", name: " 星河光芯（上海）有限公司 ", city: "上海" })).toEqual([
      "credit:91310000MA1ABC", "domain:example.com", "name-city:星河光芯有限公司|上海",
    ]);
    expect(personDedupeKeys({ name: "张 三", organization: "星河光芯", education: ["清华大学"], homepage: "https://people.example.edu/zhang" })).toContain("homepage:people.example.edu/zhang");
    expect(technologyDedupeKeys({ name: "片上 光互连", identifiers: ["doi:10.1000/xyz"], topics: ["Silicon Photonics"] })).toEqual([
      "technology:片上光互连", "identifier:doi:10.1000/xyz", "topic:siliconphotonics",
    ]);
  });

  it("accepts a versioned Codex bundle but rejects private contacts, unsafe URLs and unknown fields", () => {
    const bundle = { schemaVersion: "1.0", batch: { id: "batch-1", createdAt: "2026-09-13T01:00:00.000Z", createdBy: "Codex", accessClass: "public" as const }, items: [candidate] };
    expect(candidateBundleSchema.parse(bundle).items).toHaveLength(1);
    expect(() => candidateBundleSchema.parse({ ...bundle, items: [{ ...candidate, contacts: [{ type: "personal_mobile", value: "13800000000", sourceRef: "source-1", verifiedAt: source.observedAt }] }] })).toThrow();
    expect(() => candidateBundleSchema.parse({ ...bundle, items: [{ ...candidate, evidence: [{ ...source, url: "http://127.0.0.1/admin" }] }] })).toThrow();
    expect(() => candidateBundleSchema.parse({ ...bundle, items: [{ ...candidate, evidence: [{ ...source, url: "https://[fd00::1]/admin" }] }] })).toThrow();
    expect(() => candidateBundleSchema.parse({ ...bundle, items: [{ ...candidate, evidence: [{ ...source, url: "https://[::ffff:127.0.0.1]/admin" }] }] })).toThrow();
    expect(() => candidateBundleSchema.parse({ ...bundle, items: [{ ...candidate, evidence: [{ ...source, accessClass: "licensed_internal", allowExternalModel: true }] }] })).toThrow();
    expect(() => candidateBundleSchema.parse({ ...bundle, items: [{ ...candidate, contacts: [{ type: "work_email", value: "founder@gmail.com", sourceRef: "source-1", verifiedAt: source.observedAt }] }] })).toThrow();
    expect(() => candidateBundleSchema.parse({ ...bundle, items: [{ ...candidate, contacts: [{ type: "work_phone", value: "13800000000", sourceRef: "source-1", verifiedAt: source.observedAt }] }] })).toThrow();
    const licensedSource = { ...source, accessClass: "licensed_internal" as const, allowExternalModel: false };
    expect(() => candidateBundleSchema.parse({ ...bundle, batch: { ...bundle.batch, accessClass: "licensed_internal" }, items: [{ ...candidate, evidence: [licensedSource] }] })).toThrow();
    expect(() => candidateBundleSchema.parse({ ...bundle, unexpected: true })).toThrow();
  });

  it("ships four public-search plan families with the agreed cadence while licensed adapters remain separate", () => {
    expect(defaultDiscoveryPlans.map((plan) => [plan.channel, plan.schedule])).toEqual([
      ["venture_tech", { frequency: "daily", time: "05:30", weekdaysOnly: false }],
      ["registry", { frequency: "every_two_days", time: "06:00", weekdaysOnly: false }],
      ["hiring", { frequency: "every_two_days", time: "06:30", weekdaysOnly: false }],
      ["ranking_award", { frequency: "weekly", time: "05:00", weekdaysOnly: false, weekday: 0 }],
    ]);
    expect(defaultDiscoveryPlans.every((plan) => plan.cities[0] === "北京" && plan.tracks.length === 7)).toBe(true);
    expect(defaultDiscoveryPlans.every((plan) => plan.enabled && plan.connectorType !== "licensed_api")).toBe(true);
  });
});
