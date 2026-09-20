// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ProjectCatalog } from "@/components/operating/project-catalog";
import { buildProjectCatalog } from "@/workbench/project-catalog";
import { getPrimaryWorkspaceNavigation, getWorkspaceNavigation } from "@/prototype/navigation";
import type { IntelligenceCandidateView } from "@/intelligence/repository";
afterEach(cleanup);
const rows = buildProjectCatalog([{ id: "paused", name: "暂停芯片", legalName: "暂停芯片公司", track: "半导体", status: "pass", owner: "负责人甲", eventAt: "2026-09-04T02:00:00Z", whyNow: "等待窗口" }], []);
it("keeps the complete catalog in more after adding the separate calendar tab", () => {
  const navigation = getWorkspaceNavigation();
  expect(navigation.find(r => r.href === "/all-projects")?.label).toBe("全部项目");
  expect(getPrimaryWorkspaceNavigation(navigation)).toHaveLength(6);
  expect(getPrimaryWorkspaceNavigation(navigation).some(r => r.href === "/all-projects")).toBe(false);
});
it("offers independent category, track, date range and responsible filters with retained historical detail links", () => {
  render(<ProjectCatalog rows={rows} filters={{}} />);
  for (const label of ["项目类别", "赛道", "负责人", "开始日期", "结束日期"]) expect(screen.getByLabelText(label)).toBeTruthy();
  for (const label of ["跟进中", "已投项目", "退出项目", "中止项目", "其他项目"]) expect(screen.getByRole("option", { name: label })).toBeTruthy();
  expect(screen.getByRole("link", { name: "暂停芯片" }).getAttribute("href")).toBe("/projects/paused");
  expect(screen.getByText(/^暂不跟进 · 负责人/)).toBeTruthy();
});
it("shows a clear empty state and preserves filters", () => {
  render(<ProjectCatalog rows={rows} filters={{ category: "invested", owner: "负责人甲" }} />);
  expect(screen.getByText("没有符合筛选条件的项目")).toBeTruthy();
  expect((screen.getByLabelText("项目类别") as HTMLSelectElement).value).toBe("invested");
  expect((screen.getByLabelText("负责人") as HTMLSelectElement).value).toBe("负责人甲");
});
it("keeps older comprehensive discoveries in all projects with the familiar card actions", () => {
  const candidate: IntelligenceCandidateView = {
    id: "historical-intelligence", legacyProjectCandidateId: null, entityType: "company", candidateKind: "new_entity", name: "历史全面项目", track: "AI", subtrack: "Agent 数据", city: "杭州", signalType: "funding", eventDate: "2026-08-20", channel: "manual_codex",
    discoveryReason: "公开报道披露融资。", investmentSummary: "公司形成真实任务环境、评测与训练数据闭环。团队来自头部模型公司。关键待核问题是客户收入。", investmentHighlights: ["数据闭环"], priority: "B",
    scores: { technology: 4, team: 4, commercial: 2, signal: 4, evidence: 4 }, completeness: "L2", openQuestions: ["客户收入如何？"], missingFields: [], matchedEntityType: null, matchedEntityId: null, matchConfidence: null, matchReason: null,
    status: "pending_review", version: 1, reviewReason: null, promotedEntityId: null, details: { company: { products: ["Agent 数据平台"], fundingHistory: [{ investors: ["产业资本"] }] } }, createdAt: "2026-08-20T01:00:00+08:00", updatedAt: "2026-08-20T01:00:00+08:00",
    evidence: [{ id: "source", ref: "news", title: "融资报道", url: "javascript:alert(1)", excerpt: "融资与产品信息。", authority: "B" }], assertions: [], relationships: [], contacts: [],
  };
  const intelligenceRow = {
    id: candidate.id, kind: "intelligence" as const, name: candidate.name, legalName: "", track: candidate.track, subtrack: candidate.subtrack ?? "", category: "other" as const,
    statusLabel: "新项目发现 · 待审核", owners: [], latestAt: "2026-08-20T00:00:00+08:00", summary: candidate.investmentSummary, intelligenceCandidate: candidate,
  };

  render(<ProjectCatalog rows={[intelligenceRow]} filters={{}} canAdmin canReview />);

  expect(screen.getByRole("region", { name: "历史全面项目投资速览" })).toHaveTextContent("行业分类");
  expect(screen.queryByText("Agent 数据平台")).toBeNull();
  expect(screen.getByRole("button", { name: "查看历史全面项目项目详情" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "查看历史全面项目项目详情" }));
  expect(screen.getByText("Agent 数据平台")).toBeVisible();
  expect(screen.getByRole("button", { name: "编辑历史全面项目信息" })).toBeVisible();
  expect(screen.getByRole("button", { name: "暂不跟进历史全面项目" })).toBeVisible();
  expect(screen.getByRole("button", { name: "入库历史全面项目" })).toBeVisible();
  expect(screen.getByText("融资报道")).toBeVisible();
  expect(screen.queryByRole("link", { name: "融资报道" })).toBeNull();
});
