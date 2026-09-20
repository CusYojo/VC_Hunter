// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiscoverTabs } from "@/components/discover-tabs";

const dashboard = {
  asOf: "2026-09-14T00:00:00.000Z", windowDays: 30,
  totals: { events: 0, disclosedCny: 0, disclosedUsd: 0, undisclosed: 0, maEvents: 0 },
  byTrack: [], byRound: [], monthly: [], activeInvestors: [], latestEvents: [],
};
const intelligenceCandidate = {
  id: "new-company", legacyProjectCandidateId: null, entityType: "company" as const, candidateKind: "new_entity" as const,
  name: "重点光芯", track: "半导体", subtrack: "硅光", city: "上海", signalType: "funding", eventDate: "2026-09-14", channel: "venture_tech",
  discoveryReason: "公司完成新融资。", investmentSummary: "公司围绕硅光芯片形成产品与量产能力。投资亮点是团队具有产业经验，并获得头部机构投资。关键待核问题是客户验证与量产良率。", investmentHighlights: ["产品与量产协同"],
  priority: "A" as const, scores: { technology: 4, team: 4, commercial: 3, signal: 4, evidence: 4 }, completeness: "L2" as const,
  openQuestions: ["量产良率如何？"], missingFields: [], matchedEntityType: null, matchedEntityId: null, matchConfidence: null, matchReason: null,
  status: "pending_review" as const, version: 1, reviewReason: null, promotedEntityId: null, details: { company: { products: ["硅光芯片"], coreTechnologies: [], fundingHistory: [] } },
  createdAt: "2026-09-14T00:00:00.000Z", updatedAt: "2026-09-14T00:00:00.000Z", evidence: [], assertions: [], relationships: [], contacts: [],
};

describe("DiscoverTabs", () => {
  it("uses one project-discovery module and embeds new candidates without a duplicate legacy card", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-14T04:00:00Z"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { items: [], total: 0 } }))));
    render(<DiscoverTabs dashboard={dashboard} investorNames={{}} directory={[]} directoryTotal={0} jobs={[]} candidates={[{
      id: "legacy-company", companyName: "旧项目线索", track: "半导体", investorNames: [], signalType: "investment", summary: "旧线索摘要", confidence: 0.8,
      status: "pending_review", version: 1, lead: { title: "来源", url: "https://example.com", publishedAt: "2026-09-14", publicationVerifiedAt: "2026-09-14T00:00:00.000Z" }, projectId: null, createdAt: "2026-09-14T00:00:00.000Z",
    }]} intelligenceCandidates={[intelligenceCandidate, { ...intelligenceCandidate, id: "legacy-company", legacyProjectCandidateId: "legacy-company", name: "旧项目线索", priority: "C" as const, completeness: "L0" as const }]} intelligenceTotal={2} intelligencePlans={[]} team={[]} currentUser="投资经理" />);

    expect(screen.getByRole("tab", { name: "项目发现" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "统一情报队列" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "原项目发现" })).toBeNull();
    expect(screen.getByRole("heading", { name: "重点光芯" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "旧项目线索" })).toHaveLength(1);
    vi.useRealTimers();
  });
});
