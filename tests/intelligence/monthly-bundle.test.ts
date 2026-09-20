import { describe, expect, it } from "vitest";
import { candidateBundleSchema } from "@/intelligence/contracts";
import { buildMonthlyCandidateBundle } from "@/intelligence/monthly-bundle";

const baseDraft = {
  batchId: "hot-projects-2026-09-14",
  windowFrom: "2026-08-15",
  windowTo: "2026-09-14",
  records: [{
    externalId: "monthly-company-001",
    name: "示例光芯",
    legalName: "上海示例光芯科技有限公司",
    track: "半导体" as const,
    subtrack: "硅光互连",
    city: "上海",
    eventDate: "2026-09-01",
    signalType: "funding",
    signalSummary: "公司宣布完成亿元级A轮融资，资金用于硅光芯片量产验证。",
    products: ["硅光互连芯片"],
    coreTechnology: "片上微环调制与光电协同封装",
    teamSummary: "创始团队来自公开披露的高校实验室与芯片企业。",
    highlight: "芯片、封装与客户验证形成协同",
    question: "量产良率和客户订单能否由独立材料验证？",
    scores: { technology: 4, team: 3, commercial: 2, signal: 4, evidence: 4 },
    officialWebsite: "https://example.com/",
    qccSearchUrl: "https://www.qcc.com/web/search?key=example",
    evidence: [{
      ref: "official-funding",
      title: "公司融资公告",
      url: "https://example.com/news/funding",
      publishedAt: "2026-09-01T09:00:00.000+08:00",
      excerpt: "公司公告披露完成融资及资金用途。",
      authority: "A" as const,
    }],
    founders: [{ name: "李示例", role: "创始人", evidenceRef: "official-funding" }],
    funding: {
      round: "a" as const,
      announcedAt: "2026-09-01",
      disclosureType: "range" as const,
      amount: 100_000_000,
      currency: "CNY" as const,
      investors: ["示例资本"],
      leadInvestors: ["示例资本"],
      sourceRefs: ["official-funding"],
    },
  }],
};

describe("monthly intelligence bundle builder", () => {
  it("turns a compact research draft into a strict L1 review bundle", () => {
    const bundle = buildMonthlyCandidateBundle(baseDraft, {
      createdAt: "2026-09-14T12:00:00.000+08:00",
      observedAt: "2026-09-14T11:30:00.000+08:00",
      createdBy: "Codex monthly research",
    });

    expect(candidateBundleSchema.safeParse(bundle).success).toBe(true);
    expect(bundle.items).toHaveLength(1);
    expect(bundle.items[0].investmentSummary.length).toBeGreaterThanOrEqual(120);
    expect(bundle.items[0].investmentSummary.length).toBeLessThanOrEqual(300);
    expect(bundle.items[0].assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "legalName", valueStatus: "known", evidenceRefs: ["official-funding"] }),
      expect.objectContaining({ field: "competitors", valueStatus: "unknown" }),
      expect.objectContaining({ field: "contacts", valueStatus: "unknown" }),
    ]));
  });

  it("keeps an unopened QCC search link as a manual task instead of evidence for company facts", () => {
    const item = buildMonthlyCandidateBundle(baseDraft, {
      createdAt: "2026-09-14T12:00:00.000+08:00",
      observedAt: "2026-09-14T11:30:00.000+08:00",
      createdBy: "Codex monthly research",
    }).items[0];

    expect(item.evidence.find((evidence) => evidence.ref === "qcc-manual")).toMatchObject({
      allowExternalModel: false,
      authority: "D",
      excerpt: "仅作为管理员人工核验入口；本次未自动抓取页面，也未据此填写工商事实。",
    });
    expect(item.assertions.filter((assertion) => assertion.evidenceRefs.includes("qcc-manual"))).toHaveLength(0);
    expect(item.openQuestions.some((question) => question.includes("企查查授权接口"))).toBe(true);
  });

  it("binds facts that were actually visible on a public QCC index page", () => {
    const item = buildMonthlyCandidateBundle({
      ...baseDraft,
      records: [{
        ...baseDraft.records[0],
        qccSearchUrl: undefined,
        qccPublicFacts: {
          url: "https://top.qcc.com/tc/example.html",
          title: "示例光芯相关企业 - 企查查",
          excerpt: "公开索引显示公司名称、成立日期和注册地址。",
          legalName: "上海示例光芯科技有限公司",
          incorporationDate: "2025-01-02",
          registeredAddress: "上海市浦东新区示例路1号",
        },
      }],
    }, {
      createdAt: "2026-09-14T12:00:00.000+08:00",
      observedAt: "2026-09-14T11:30:00.000+08:00",
      createdBy: "Codex monthly research",
    }).items[0];

    expect(item.evidence.find((evidence) => evidence.ref === "qcc-public")).toMatchObject({
      authority: "C",
      allowExternalModel: false,
    });
    expect(item.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "incorporationDate", evidenceRefs: ["qcc-public"] }),
      expect.objectContaining({ field: "registeredAddress", evidenceRefs: ["qcc-public"] }),
    ]));
    expect(item.company).toMatchObject({ incorporationDate: "2025-01-02", registeredAddress: "上海市浦东新区示例路1号" });
  });

  it("rejects events outside the declared one-month window", () => {
    expect(() => buildMonthlyCandidateBundle({
      ...baseDraft,
      records: [{ ...baseDraft.records[0], eventDate: "2026-08-14" }],
    }, {
      createdAt: "2026-09-14T12:00:00.000+08:00",
      observedAt: "2026-09-14T11:30:00.000+08:00",
      createdBy: "Codex monthly research",
    })).toThrow(/时间窗/);
  });
});
