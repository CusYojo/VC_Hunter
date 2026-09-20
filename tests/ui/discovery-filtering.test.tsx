// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DiscoveryWorkbench } from "@/components/discovery-workbench";
import type { IntelligenceCandidateView } from "@/intelligence/repository";
import type { CandidateView } from "@/workbench/candidate-details";
const candidate = (id: string, createdAt: string, status: CandidateView["status"] = "pending_review"): CandidateView => ({ id, companyName: id, track: "半导体", investorNames: [], signalType: "investment", summary: `${id}项目线索`, confidence: 0.9, status, version: 1, lead: { title: "来源", url: "https://example.com", publishedAt: createdAt, publicationVerifiedAt: createdAt }, projectId: null, createdAt });
const intelligenceCandidate = (id: string, name: string, eventDate: string): IntelligenceCandidateView => ({
  id, legacyProjectCandidateId: null, entityType: "company", candidateKind: "new_entity", name, track: "AI", subtrack: "Agent 基础设施", city: "杭州", signalType: "funding", eventDate, channel: "manual_codex",
  discoveryReason: `${name}完成新一轮融资。`, investmentSummary: `${name}围绕真实任务环境构建评测与训练数据闭环。团队具有头部模型公司经验，并获得产业资本支持。关键待核问题是客户验证与收入质量。`, investmentHighlights: ["真实任务数据闭环"],
  priority: "A", scores: { technology: 4, team: 4, commercial: 3, signal: 4, evidence: 4 }, completeness: "L2", openQuestions: ["客户复购如何？"], missingFields: [],
  matchedEntityType: null, matchedEntityId: null, matchConfidence: null, matchReason: null, status: "pending_review", version: 1, reviewReason: null, promotedEntityId: null,
  details: { company: { products: ["Agent 评测与训练数据平台"], coreTechnologies: ["Environment + Verifier"], fundingHistory: [{ investors: ["产业资本"] }] } },
  createdAt: `${eventDate}T01:00:00+08:00`, updatedAt: `${eventDate}T01:00:00+08:00`, evidence: [{ id: `${id}-source`, ref: "news", title: `${name}融资报道`, url: "https://example.com/news", excerpt: "公开报道披露融资及产品进展。", authority: "B" }], assertions: [], relationships: [{ entityType: "person", name: "创始人甲", relation: "创始人" }], contacts: [],
});
function expandLegacy(name: string) {
  const article = screen.getByRole("heading", { name }).closest("article");
  if (!article) throw new Error(`找不到 ${name} 项目卡片`);
  fireEvent.click(within(article).getByRole("button", { name: "查看项目详情" }));
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-04T04:00:00Z")); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it("defaults to candidates discovered today in Shanghai while linking to the separate project archive", () => {
  render(<DiscoveryWorkbench jobs={[]} candidates={[candidate("当天项目", "2026-09-03T16:00:00Z"), candidate("昨天项目", "2026-09-03T15:59:59Z")]} />);
  expect(screen.getByRole("heading", { name: "当天项目" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "昨天项目" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "全部项目" })).toHaveAttribute("href", "/all-projects");
  expect(screen.queryByRole("button", { name: "全部项目" })).toBeNull();
});
it("shows the inclusive recent seven Shanghai calendar days", () => {
  render(<DiscoveryWorkbench jobs={[]} candidates={[candidate("当天项目", "2026-09-04T00:00:00Z"), candidate("周内项目", "2026-08-29T00:00:00Z"), candidate("旧项目", "2026-08-28T00:00:00Z")]} />);
  fireEvent.click(screen.getByText("近一周", { exact: true }));
  expect(screen.getByRole("heading", { name: "周内项目" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "旧项目" })).not.toBeInTheDocument();
  expect(screen.queryByRole("table")).toBeNull();
});
it("places comprehensive company discoveries in the original card timeline by event date", () => {
  const today = intelligenceCandidate("intelligence-today", "当日全面项目", "2026-09-04");
  const week = intelligenceCandidate("intelligence-week", "周内全面项目", "2026-08-29");
  const older = intelligenceCandidate("intelligence-older", "历史全面项目", "2026-08-28");
  render(<DiscoveryWorkbench jobs={[]} candidates={[candidate("原卡片项目", "2026-09-04T00:00:00Z")]} intelligenceCandidates={[today, week, older]} canAdmin canReview />);

  const timeline = screen.getByRole("region", { name: "待查看项目列表" });
  expect(timeline).toContainElement(screen.getByRole("heading", { name: "当日全面项目" }));
  expect(timeline).toContainElement(screen.getByRole("heading", { name: "原卡片项目" }));
  expect(screen.queryByRole("heading", { name: "周内全面项目" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "历史全面项目" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "重点新项目" })).toBeNull();
  expect(screen.getByRole("region", { name: "当日全面项目投资速览" })).toHaveTextContent("核心团队背景");
  expect(screen.queryByText("Environment + Verifier")).toBeNull();
  expect(screen.getByRole("button", { name: "查看当日全面项目项目详情" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "查看当日全面项目项目详情" }));
  expect(screen.getByRole("button", { name: "编辑当日全面项目信息" })).toBeVisible();
  expect(screen.getByRole("button", { name: "上移 当日全面项目" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "下移 当日全面项目" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "暂不跟进当日全面项目" })).toBeVisible();
  expect(screen.getByRole("button", { name: "入库当日全面项目" })).toBeVisible();
  const details = screen.getByRole("region", { name: "当日全面项目详细信息" });
  expect(details).toHaveTextContent("公司画像");
  expect(details).toHaveTextContent("Environment + Verifier");
  expect(details).toHaveTextContent("产业资本");
  expect(details).toHaveTextContent("信息来源");

  fireEvent.click(screen.getByRole("button", { name: "近一周" }));
  expect(screen.getByRole("heading", { name: "周内全面项目" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "历史全面项目" })).toBeNull();
});
it("shows one card when the same comprehensive project signal arrives more than once", () => {
  const first = { ...intelligenceCandidate("intelligence-first", "重复项目", "2026-09-04"), completeness: "L0" as const, details: {} };
  const repeated = { ...intelligenceCandidate("intelligence-repeated", "重复项目", "2026-09-04"), investmentSummary: "同一融资事件的补充版本。", details: { company: { products: ["更完整版本的产品"] } } };
  render(<DiscoveryWorkbench jobs={[]} candidates={[]} intelligenceCandidates={[first, repeated]} />);
  expect(screen.getAllByRole("heading", { name: "重复项目" })).toHaveLength(1);
  expect(screen.queryByText("更完整版本的产品")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "查看重复项目项目详情" }));
  expect(screen.getByText("更完整版本的产品")).toBeVisible();
});
it("keeps the comprehensive card when it duplicates a legacy project signal", () => {
  const legacy = { ...candidate("legacy", "2026-09-04T00:00:00Z"), companyName: "同一项目", eventDate: "2026-09-04", signalType: "融资" };
  const comprehensive = intelligenceCandidate("comprehensive", "同一项目", "2026-09-04");
  render(<DiscoveryWorkbench jobs={[]} candidates={[legacy]} intelligenceCandidates={[comprehensive]} />);
  expect(screen.getAllByRole("heading", { name: "同一项目" })).toHaveLength(1);
  expect(screen.queryByText("Agent 评测与训练数据平台")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "查看同一项目项目详情" }));
  expect(screen.getByText("Agent 评测与训练数据平台")).toBeVisible();
});
it("keeps preview-only review actions local instead of calling the server", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const preview = { ...intelligenceCandidate("local-preview:unipat", "UniPat AI", "2026-09-04"), completeness: "L1" as const };
  render(<DiscoveryWorkbench jobs={[]} candidates={[]} intelligenceCandidates={[preview]} canAdmin canReview />);

  fireEvent.click(screen.getByRole("button", { name: "查看UniPat AI项目详情" }));
  fireEvent.click(screen.getByRole("button", { name: "入库UniPat AI" }));
  fireEvent.click(screen.getByRole("button", { name: "确认入库" }));

  expect(await screen.findByText("项目已在本地预览中标记为入库")).toBeVisible();
  expect(fetchMock).not.toHaveBeenCalled();
});
it("combines a keyword with an explicit discovery date", () => {
  render(<DiscoveryWorkbench jobs={[]} candidates={[candidate("芯片甲", "2026-09-02T00:00:00Z"), candidate("芯片乙", "2026-09-03T00:00:00Z"), candidate("机器人", "2026-09-02T00:00:00Z")]} />);
  fireEvent.change(screen.getByLabelText("按日期查看项目"), { target: { value: "2026-09-02" } });
  fireEvent.change(screen.getByLabelText("筛选项目关键词"), { target: { value: "芯片" } });
  expect(screen.getByText("芯片甲", { exact: true })).toBeVisible();
  expect(screen.queryByText("芯片乙", { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByText("机器人", { exact: true })).not.toBeInTheDocument();
});
it("removes dismissed and archived candidates from daily and weekly views", () => {
  render(<DiscoveryWorkbench jobs={[]} candidates={[candidate("拒绝项目", "2026-09-04T03:00:00Z", "dismissed"), candidate("待看项目", "2026-09-04T01:00:00Z"), candidate("入库项目", "2026-09-04T00:00:00Z", "promoted"), { ...candidate("归档项目", "2026-09-04T00:00:00Z"), archivedAt: "2026-09-04T01:00:00Z" }]} />);
  const names = screen.getAllByRole("article").map(article => article.querySelector("h3")?.textContent);
  expect(names).toEqual(["待看项目", "入库项目"]);
  fireEvent.click(screen.getByRole("button", { name: "近一周" }));
  expect(screen.queryByRole("heading", { name: "拒绝项目" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "归档项目" })).toBeNull();
});
it("offers manual ordering only to administrators", () => {
  const candidates = [candidate("项目甲", "2026-09-04T00:00:00Z"), candidate("项目乙", "2026-09-04T00:00:00Z")];
  const view = render(<DiscoveryWorkbench jobs={[]} candidates={candidates} />);
  expect(screen.queryByRole("button", { name: "下移 项目甲" })).not.toBeInTheDocument();
  view.rerender(<DiscoveryWorkbench jobs={[]} candidates={candidates} canAdmin />);
  expandLegacy("项目甲");
  expect(screen.getByRole("button", { name: "下移 项目甲" })).toBeVisible();
  expandLegacy("项目乙");
  expect(screen.getByRole("button", { name: "上移 项目乙" })).toBeVisible();
});

it("sends an admin move request and applies the returned group versions and order", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { items: [{ id: "甲", version: 2, queueRank: 1 }, { id: "乙", version: 2, queueRank: 0 }] } })));
  vi.stubGlobal("fetch", fetchMock);
  const rows = [candidate("甲", "2026-09-04T02:00:00Z"), candidate("乙", "2026-09-04T01:00:00Z")];
  render(<DiscoveryWorkbench jobs={[]} candidates={rows} canAdmin />);
  expandLegacy("甲");
  fireEvent.click(screen.getByRole("button", { name: "下移 甲" }));
  await screen.findByText("排序已保存");
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe("/api/v1/candidates/order"); expect(options.method).toBe("PATCH");
  expect(JSON.parse(options.body)).toEqual({ move: { id: "甲", expectedVersion: 1, direction: "down" } });
  expect(options.headers["idempotency-key"]).toBeTruthy();
  expect(screen.getAllByRole("article").map(article => article.querySelector("h3")?.textContent)).toEqual(["乙", "甲"]);
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { items: [{ id: "甲", version: 3, queueRank: 0 }, { id: "乙", version: 3, queueRank: 1 }] } })));
  fireEvent.click(screen.getByRole("button", { name: "上移 甲" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ move: { id: "甲", expectedVersion: 2, direction: "up" } });
});
it("retains a move's idempotency key on retry and leaves the old order visible after failure", async () => {
  const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("连接中断")).mockResolvedValueOnce(new Response(JSON.stringify({ data: { items: [{ id: "甲", version: 2, queueRank: 1 }, { id: "乙", version: 2, queueRank: 0 }] } })));
  vi.stubGlobal("fetch", fetchMock);
  render(<DiscoveryWorkbench jobs={[]} candidates={[candidate("甲", "2026-09-04T02:00:00Z"), candidate("乙", "2026-09-04T01:00:00Z")]} canAdmin />);
  expandLegacy("甲");
  fireEvent.click(screen.getByRole("button", { name: "下移 甲" }));
  await screen.findByText("排序失败");
  expect(screen.getAllByRole("article").map(article => article.querySelector("h3")?.textContent)).toEqual(["甲", "乙"]);
  fireEvent.click(screen.getByRole("button", { name: "下移 甲" }));
  await screen.findByText("排序已保存");
  expect(fetchMock.mock.calls[1][1].headers["idempotency-key"]).toBe(fetchMock.mock.calls[0][1].headers["idempotency-key"]);
});
it("excludes unverified and historical AI results from the daily queue", () => {
  const fresh = candidate("当天新闻", "2026-09-04T00:00:00Z");
  const stale = { ...candidate("去年新闻", "2026-09-04T00:00:00Z"), lead: { ...fresh.lead, publishedAt: "2025-09-04" } };
  const unverified = { ...candidate("未核验新闻", "2026-09-04T00:00:00Z"), lead: { ...fresh.lead, publicationVerifiedAt: null } };
  const manual = { ...candidate("人工资料", "2026-09-04T00:00:00Z"), origin: "manual_screenshot" as const, lead: { ...fresh.lead, publishedAt: null, publicationVerifiedAt: null } };
  render(<DiscoveryWorkbench jobs={[]} candidates={[fresh, stale, unverified, manual]} />);
  expect(screen.getByRole("heading", { name: "当天新闻" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "人工资料" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "去年新闻" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "未核验新闻" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "全部项目" })).toHaveAttribute("href", "/all-projects");
});
