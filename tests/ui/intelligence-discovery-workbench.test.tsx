// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntelligenceDiscoveryWorkbench } from "@/components/intelligence-discovery-workbench";

const candidates = [
  {
    id: "company-1", legacyProjectCandidateId: null, entityType: "company" as const, candidateKind: "new_entity" as const, name: "星河光芯", track: "半导体", subtrack: "光子芯片", city: "上海", signalType: "funding", eventDate: "2026-09-13", channel: "venture_tech", discoveryReason: "完成新一轮融资并发布新品。",
    investmentSummary: "面向数据中心推出新一代光子芯片并进入客户验证。投资亮点是技术路线与量产团队形成组合优势；关键待核问题是良率、客户复购与融资估值，需要通过客户访谈和工商材料继续交叉核验。", investmentHighlights: ["技术路线与量产团队形成组合优势"], priority: "A" as const, scores: { technology: 5, team: 4, commercial: 4, signal: 5, evidence: 4 }, completeness: "L2" as const, openQuestions: ["良率和客户复购如何？"], missingFields: [], matchedEntityType: null, matchedEntityId: null, matchConfidence: null, matchReason: null, status: "pending_review" as const, version: 1, reviewReason: null, promotedEntityId: null, details: { company: { products: ["数据中心光子芯片"], coreTechnologies: ["硅光集成与量产工艺"], fundingHistory: [{ investors: ["红杉中国", "源码资本"], leadInvestors: ["红杉中国"] }] } }, createdAt: "2026-09-14T01:00:00.000Z", updatedAt: "2026-09-14T01:00:00.000Z",
    evidence: [{ ref: "official", title: "公司公告", url: "https://example.com/news", publishedAt: "2026-09-13T01:00:00.000Z", observedAt: "2026-09-14T01:00:00.000Z", excerpt: "公司完成融资。", authority: "A" }], assertions: [], relationships: [{ entityType: "person", name: "周明", relation: "创始人兼CEO", confidence: 0.9, evidenceRefs: ["official"] }], contacts: [],
  },
  {
    id: "person-1", legacyProjectCandidateId: null, entityType: "person" as const, candidateKind: "new_entity" as const, name: "张新", track: "AI", subtrack: "多模态", city: "北京", signalType: "award", eventDate: "2026-09-12", channel: "ranking_award", discoveryReason: "入选青年科技人才榜单。", investmentSummary: "", investmentHighlights: [], priority: "B" as const, scores: { technology: 4, team: 4, commercial: 1, signal: 3, evidence: 3 }, completeness: "L1" as const, openQuestions: ["产业化意愿如何？"], missingFields: ["employment"], matchedEntityType: null, matchedEntityId: null, matchConfidence: null, matchReason: null, status: "pending_review" as const, version: 1, reviewReason: null, promotedEntityId: null, details: {}, createdAt: "2026-09-14T01:00:00.000Z", updatedAt: "2026-09-14T01:00:00.000Z", evidence: [], assertions: [], relationships: [], contacts: [],
  },
];

const plans = [{ id: "registry", name: "工商科技企业", channel: "registry", queryFamily: "科技企业设立与工商变更", tracks: ["AI"], subtracks: [], cities: ["北京"], preferredDomains: [], dateWindowDays: 2, connectorType: "licensed_api", enabled: false, schedule: { frequency: "every_two_days", time: "06:00", weekdaysOnly: false }, nextRunAt: null, version: 1, updatedAt: "2026-09-14T01:00:00.000Z" }];
const publicPlan = { id: "venture-tech", name: "创投与科技动态", channel: "venture_tech", queryFamily: "融资与产品发布", tracks: ["AI", "半导体"], subtracks: ["光子芯片"], cities: ["北京", "上海"], preferredDomains: ["36kr.com"], dateWindowDays: 2, connectorType: "public_search", connectorReady: true, enabled: true, schedule: { frequency: "daily", time: "05:30", weekdaysOnly: false }, nextRunAt: "2026-09-15T21:30:00.000Z", version: 1, updatedAt: "2026-09-14T01:00:00.000Z" };

describe("IntelligenceDiscoveryWorkbench", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows a scannable project discovery view with all filters, evidence and missing fields", () => {
    render(<IntelligenceDiscoveryWorkbench initialCandidates={candidates} initialTotal={2} initialPlans={plans} canAdmin canReview />);
    expect(screen.getByRole("heading", { name: "重点新项目" })).toBeTruthy();
    expect(screen.getByText("星河光芯")).toBeTruthy();
    expect(screen.getAllByText("A 级")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "查看星河光芯证据与缺口" }));
    expect(screen.getByRole("link", { name: "公司公告" }).getAttribute("href")).toBe("https://example.com/news");
    fireEvent.change(screen.getByLabelText("主体类型"), { target: { value: "person" } });
    expect(screen.queryByText("星河光芯")).toBeNull();
    expect(screen.getByText("张新")).toBeTruthy();
    expect(screen.getByText("待补：employment")).toBeTruthy();
    expect((screen.getByRole("button", { name: "待采购授权" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("presents imported companies as project cards with a concise investment brief", () => {
    render(<IntelligenceDiscoveryWorkbench initialCandidates={candidates.slice(0, 1)} initialTotal={1} initialPlans={plans} canReview />);

    expect(screen.queryByRole("heading", { name: "统一情报队列" })).toBeNull();
    expect(screen.getByRole("heading", { name: "重点新项目" })).toBeTruthy();
    const brief = screen.getByRole("region", { name: "星河光芯投资速览" });
    expect(brief).toHaveTextContent("面向数据中心推出新一代光子芯片并进入客户验证");
    expect(brief).toHaveTextContent("行业分类");
    expect(brief).toHaveTextContent("最新融资日期");
    expect(brief).toHaveTextContent("融资金额");
    expect(brief).toHaveTextContent("核心团队背景");
    expect(brief).toHaveTextContent("周明（创始人兼CEO）");
    expect(brief).toHaveTextContent("投资方");
    expect(brief).toHaveTextContent("红杉中国、源码资本");
    expect(screen.getByRole("button", { name: "暂不跟进星河光芯" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "入库星河光芯" })).toBeTruthy();
  });

  it("keeps legacy backfills and repeated project information out of every loaded page", async () => {
    const legacyBackfill = { ...candidates[0], id: "legacy-backfill", legacyProjectCandidateId: "legacy-company", name: "旧项目线索" };
    const repeatedInformation = { ...candidates[0], id: "company-repeat" };
    const nextProject = { ...candidates[0], id: "company-2", name: "第二个重点项目", investmentSummary: "公司完成新一轮产品验证。" };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { items: [repeatedInformation, nextProject], total: 5 } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<IntelligenceDiscoveryWorkbench initialCandidates={[...candidates, legacyBackfill]} initialTotal={5} initialPlans={plans} />);

    expect(screen.queryByRole("heading", { name: "旧项目线索" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /加载更多项目/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/v1/discovery/items?limit=200&offset=3"));
    expect(await screen.findByRole("heading", { name: "第二个重点项目" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "星河光芯" })).toHaveLength(1);
  });

  it("requires an explicit second confirmation before committing a Codex bundle", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { importId: "batch-1", version: 1, total: 2, valid: 1, errors: [{ index: 1, message: "evidence.0.url: URL 必须是公开 HTTPS 地址" }], duplicates: [], items: [{ index: 0, name: "星河光芯", completeness: "L1", priority: "B", matches: [{ name: "星河光芯科技", confidence: 0.84, reason: "公司名称与城市一致" }] }] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { importId: "batch-1", inserted: 1, skipped: 0, candidateIds: ["new-1"] } }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<IntelligenceDiscoveryWorkbench initialCandidates={[]} initialTotal={0} initialPlans={plans} canAdmin canReview />);
    fireEvent.change(screen.getByLabelText("上传 Codex 数据包"), { target: { files: [new File(["{}"], "bundle.json", { type: "application/json" })] } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByText("预检完成：1 条可导入")).toBeTruthy();
    expect(screen.getByText("第 2 条：evidence.0.url: URL 必须是公开 HTTPS 地址")).toBeTruthy();
    expect(screen.getByText(/星河光芯科技.*84%/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/discovery/imports/preview", expect.objectContaining({ method: "POST" }));
    fireEvent.click(screen.getByRole("button", { name: "确认写入待审队列" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("keeps formal ingestion behind a reasoned human review", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { ...candidates[0], status: "promoted", version: 2 } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<IntelligenceDiscoveryWorkbench initialCandidates={candidates.slice(0, 1)} initialTotal={1} initialPlans={plans} canAdmin={false} canReview />);
    fireEvent.click(screen.getByRole("button", { name: "入库星河光芯" }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("审核意见"), { target: { value: "来源可追溯，建议进入正式跟进。" } });
    fireEvent.click(screen.getByRole("button", { name: "确认入库" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/v1/discovery/items/company-1/review", expect.objectContaining({ method: "PATCH" })));
    expect(await screen.findByText("已入正式库")).toBeTruthy();
  });

  it("offers an explicit merge path for a matched existing entity", async () => {
    const matched = { ...candidates[0], candidateKind: "entity_update" as const, matchedEntityType: "company" as const, matchedEntityId: "existing-company", matchConfidence: 0.98, matchReason: "官网域名一致" };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { ...matched, status: "merged", version: 2 } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<IntelligenceDiscoveryWorkbench initialCandidates={[matched]} initialTotal={1} initialPlans={plans} canAdmin={false} canReview />);
    fireEvent.click(screen.getByRole("button", { name: "合并星河光芯到已有实体" }));
    fireEvent.change(screen.getByLabelText("审核意见"), { target: { value: "确认官网域名一致，作为已有公司的新增信号合并。" } });
    fireEvent.click(screen.getByRole("button", { name: "确认合并" }));
    await waitFor(() => expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ decision: "merge", matchedEntityType: "company", matchedEntityId: "existing-company" }));
  });

  it("lets an administrator edit query families, scope and cadence", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { ...publicPlan, queryFamily: "融资、并购与产品发布", cities: ["北京", "上海", "深圳"], version: 2 } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<IntelligenceDiscoveryWorkbench initialCandidates={[]} initialTotal={0} initialPlans={[publicPlan]} canAdmin canReview />);
    fireEvent.click(screen.getByRole("button", { name: "配置创投与科技动态" }));
    fireEvent.change(screen.getByLabelText("查询主题"), { target: { value: "融资、并购与产品发布" } });
    fireEvent.change(screen.getByLabelText("重点城市"), { target: { value: "北京，上海，深圳" } });
    fireEvent.change(screen.getByLabelText("运行时间"), { target: { value: "06:15" } });
    fireEvent.click(screen.getByRole("button", { name: "保存计划" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      id: "venture-tech", queryFamily: "融资、并购与产品发布", cities: ["北京", "上海", "深圳"], expectedVersion: 1,
      schedule: { frequency: "daily", time: "06:15", weekdaysOnly: false },
    });
  });
});
