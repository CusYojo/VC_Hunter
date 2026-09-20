// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { IntelligenceProjectCard } from "@/components/intelligence-project-card";
import { buildIntelligenceInvestmentBrief, buildLegacyInvestmentBrief } from "@/components/discovery-investment-brief";
import type { IntelligenceCandidateView } from "@/intelligence/repository";
import type { CandidateView } from "@/workbench/candidate-details";

const candidate: IntelligenceCandidateView = {
  id: "card-layout-company",
  legacyProjectCandidateId: null,
  entityType: "company",
  candidateKind: "new_entity",
  name: "星河光芯",
  track: "半导体",
  subtrack: "薄膜铌酸锂光子芯片",
  city: "杭州",
  signalType: "funding",
  eventDate: "2026-09-18",
  channel: "manual_codex",
  discoveryReason: "公司完成新一轮融资。",
  investmentSummary: "公司面向AI数据中心研发高速低功耗光子芯片。第二句话属于展开后的研究说明。",
  investmentHighlights: ["晶圆工艺与光子引擎协同"],
  priority: "A",
  scores: { technology: 5, team: 5, commercial: 3, signal: 5, evidence: 5 },
  completeness: "L2",
  openQuestions: ["晶圆良率如何？"],
  missingFields: [],
  matchedEntityType: null,
  matchedEntityId: null,
  matchConfidence: null,
  matchReason: null,
  status: "pending_review",
  version: 1,
  reviewReason: null,
  promotedEntityId: null,
  details: {
    company: {
      products: ["高速电光调制芯片"],
      coreTechnologies: ["薄膜铌酸锂光子集成"],
      fundingHistory: [
        { round: "pre_a", announcedAt: "2026-09-18", amount: 100_000_000, currency: "CNY", disclosureType: "range", investors: ["孚腾资本", "上海未来产业基金"], leadInvestors: ["孚腾资本"] },
        { round: "angel", announcedAt: "2025-06-06", amount: 30_000_000, currency: "CNY", disclosureType: "range", investors: ["元禾原点"], leadInvestors: [] },
      ],
    },
  },
  createdAt: "2026-09-18T10:00:00+08:00",
  updatedAt: "2026-09-18T10:00:00+08:00",
  evidence: [{ id: "source", ref: "funding", title: "融资报道", url: "https://example.com/funding", excerpt: "公司完成融资。", authority: "B" }],
  assertions: [{ field: "coreTeam", label: "核心团队", valueStatus: "known", epistemicType: "fact", value: "创始人为哈佛电子工程博士，团队覆盖晶圆工艺、芯片设计与封装。", confidence: 0.95, evidenceRefs: ["funding"] }],
  relationships: [{ entityType: "person", name: "王博士", relation: "创始人、首席科学家", confidence: 0.95, evidenceRefs: ["funding"] }],
  contacts: [],
};

const legacy: CandidateView = {
  id: "legacy-company",
  companyName: "传统项目",
  track: "先进制造",
  rawTrack: "工业机器人",
  investorNames: ["产业资本"],
  signalType: "investment",
  summary: "公司提供工业机器人控制系统。其余分析应在展开后查看。",
  confidence: 0.9,
  status: "pending_review",
  version: 1,
  lead: { title: "来源", url: "https://example.com/legacy", publishedAt: "2026-09-17", publicationVerifiedAt: "2026-09-17T01:00:00Z" },
  projectId: null,
  createdAt: "2026-09-17T01:00:00Z",
  eventDate: "2026-09-17",
  round: "A轮",
  amountText: "1亿元",
};

afterEach(() => document.body.replaceChildren());

describe("discovery card information hierarchy", () => {
  it("builds the collapsed company summary from the latest financing and the full team assertion", () => {
    const brief = buildIntelligenceInvestmentBrief(candidate);

    expect(brief.summary).toBe("公司面向AI数据中心研发高速低功耗光子芯片。");
    expect(Object.fromEntries(brief.facts.map((item) => [item.label, item.value]))).toEqual({
      行业分类: "半导体 / 薄膜铌酸锂光子芯片",
      最新融资日期: "2026-09-18",
      融资金额: "约1亿元人民币",
      融资轮次: "Pre-A轮",
      投资方: "孚腾资本、上海未来产业基金",
      核心团队背景: "创始人为哈佛电子工程博士，团队覆盖晶圆工艺、芯片设计与封装。",
    });
  });

  it("keeps detailed company information and review actions behind the expand control", () => {
    render(<IntelligenceProjectCard candidate={candidate} canAdmin canReview />);

    expect(screen.getByRole("heading", { name: "星河光芯" })).toBeVisible();
    const brief = screen.getByRole("region", { name: "星河光芯投资速览" });
    for (const label of ["行业分类", "最新融资日期", "融资金额", "融资轮次", "投资方", "核心团队背景"]) expect(brief).toHaveTextContent(label);
    expect(brief).toHaveTextContent("公司面向AI数据中心研发高速低功耗光子芯片。");
    expect(brief).not.toHaveTextContent("第二句话属于展开后的研究说明");
    expect(screen.queryByText("高速电光调制芯片")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "入库星河光芯" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看星河光芯项目详情" }));

    expect(screen.getByRole("heading", { name: "星河光芯" }).closest("article")).toHaveClass("md:col-span-2", "xl:col-span-3");
    const details = screen.getByRole("region", { name: "星河光芯详细信息" });
    expect(details).toHaveTextContent("高速电光调制芯片");
    expect(details).toHaveTextContent("Pre-A轮 · 1亿元人民币 · 孚腾资本、上海未来产业基金");
    expect(screen.getByText("薄膜铌酸锂光子集成")).toBeVisible();
    expect(screen.getByRole("button", { name: "入库星河光芯" })).toBeVisible();
    expect(screen.getByRole("button", { name: "编辑星河光芯信息" })).toBeVisible();
  });

  it("uses the same concise field order for legacy company cards", () => {
    const brief = buildLegacyInvestmentBrief(legacy);

    expect(brief.summary).toBe("公司提供工业机器人控制系统。");
    expect(brief.facts.map((item) => item.label)).toEqual(["行业分类", "最新融资日期", "融资金额", "融资轮次", "投资方", "核心团队背景"]);
    expect(brief.facts.map((item) => item.value)).toEqual(["工业机器人", "2026-09-17", "1亿元", "A轮", "产业资本", "待补充"]);
  });
});
