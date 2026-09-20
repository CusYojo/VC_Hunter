// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvestorProfile } from "@/components/investor-profile";
import { InvestorProfileEditor } from "@/components/investor-profile-editor";
import { investorProfile } from "../fixtures/investor-profile";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

describe("institution profile", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
  it("separates source examples, linked events and undisclosed metrics", () => {
    render(<InvestorProfile investor={investorProfile} people={[]} canEdit={false} />);
    for (const title of ["测试创投", "机构概况", "核心成员与合伙人", "公开投资示例", "已关联投资记录", "赛道历史数据", "来源与核验"]) expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "公开投资示例" })).getByText("甲公司（2026，公开示例）")).toBeTruthy();
    expect(screen.getByText("暂无已关联的投资记录")).toBeTruthy();
    expect(screen.getByText("暂无经录入的赛道历史数据，不推算回报率。")).toBeTruthy();
    expect(screen.getByText("未统一公开")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "编辑机构档案" })).toBeNull();
    expect(screen.getByRole("link", { name: /https:\/\/example.com\/about\// }).getAttribute("href")).toBe("https://example.com/about/");
    expect(screen.queryByRole("link", { name: "javascript:alert(1)" })).toBeNull();
  });
  it("shows only supplied members and independently recorded performance without inventing returns", () => {
    render(<InvestorProfile investor={{ ...investorProfile, keyPeople: [{ name: "张三", title: "合伙人", focusTracks: ["AI"] }], trackPerformance: { AI: { invested: 12, exits: 2, followOnRate: null } } }} people={[]} canEdit={false} />);
    expect(screen.getByText("张三")).toBeTruthy();
    expect(screen.getByText("合伙人")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.queryByText(/IRR|MOIC|年化收益/)).toBeNull();
  });
  it("sends only changed profile fields with expectedVersion and an idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { ...investorProfile, investmentStyle: "专注早期硬科技", version: 5 } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<InvestorProfileEditor investor={investorProfile} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑机构档案" }));
    fireEvent.change(screen.getByLabelText("投资风格"), { target: { value: "专注早期硬科技" } });
    fireEvent.click(screen.getByRole("button", { name: "保存档案" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/investors/inv-test");
    expect(request.method).toBe("PATCH");
    expect(request.headers["idempotency-key"]).toBeTruthy();
    expect(JSON.parse(request.body)).toEqual({ expectedVersion: 4, investmentStyle: "专注早期硬科技" });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.getByRole("status").textContent).toContain("已保存");
  });
  it("keeps inputs on conflict and never pretends the save succeeded", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "版本冲突" } }), { status: 409 })));
    render(<InvestorProfileEditor investor={investorProfile} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑机构档案" }));
    fireEvent.change(screen.getByLabelText("备注"), { target: { value: "我的修改" } });
    fireEvent.click(screen.getByRole("button", { name: "保存档案" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("已被他人更新"));
    expect((screen.getByLabelText("备注") as HTMLTextAreaElement).value).toBe("我的修改");
    expect(refresh).not.toHaveBeenCalled();
  });
  it("shows rich evidence-backed profiles with explicit missing amounts", () => {
    render(<InvestorProfile investor={{ ...investorProfile, englishName: "Test VC", aliases: ["旧名"], stageFocus: ["A轮"], subtracks: ["模型"], investmentStyle: "早期", thesis: "硬科技", updatedAt: "2026-09-04", extra: {},
      fundSize: { amount: null, currency: null, text: "100亿（官网口径）", source: "官网" },
      verification: { verifiedAt: "2026-09-01", verifiedBy: "投研团队", notes: "核验说明" },
      sourceRefs: ["非链接文本"], portfolioSample: [{ company: "乙公司", year: 2026, round: "A轮" }],
      keyPeople: [{ name: "李四" }], trackPerformance: { AI: { invested: 3, exits: 1, followOnRate: 0.5 } },
      investmentHistory: [
        { id: "event1", companyId: "co1", companyName: "已投公司", track: "AI", round: "a", announcedAt: "2026-09-01", amount: null, currency: null, disclosureType: "undisclosed", investors: ["测试创投"], leadInvestors: [], confidence: 0.8 },
        { id: "event2", companyId: "co2", companyName: "另一公司", track: "AI", round: "a", announcedAt: "2026-09-01", amount: 100, currency: "CNY", disclosureType: "exact", investors: ["测试创投"], leadInvestors: [], confidence: 0.8 },
      ],
    }} people={[{ id: "person1", name: "王五", aliases: [], currentOrganization: "测试创投", currentTitle: null, track: null, companyRoles: [], previousStartups: [], technicalEvidenceCount: 1, careerEvents24m: 1, privacyBasis: "professional_profile", confidence: 0.9 }]} canEdit />);
    expect(screen.getByRole("link", { name: /王五/ }).getAttribute("href")).toBe("/people/person1");
    expect(screen.getByText("金额未披露")).toBeTruthy();
    expect(screen.getByText("100 CNY")).toBeTruthy();
    expect(screen.getByText("50.0%")).toBeTruthy();
    expect(screen.getByText("乙公司 · 2026 · A轮")).toBeTruthy();
  });
  it("shows fully missing source and profile data as unrecorded", () => {
    render(<InvestorProfile investor={{ ...investorProfile, headquarters: null, focusTracks: [], notes: "", fundSize: null, verification: null, sourceRefs: [], extra: {} }} people={[]} canEdit={false} />);
    expect(screen.getByText("暂无来源链接")).toBeTruthy();
    expect(screen.getByText("暂无跟进备注")).toBeTruthy();
  });
  it("normalizes changed editable fields without discarding unrelated member attributes", async () => {
    const original = { ...investorProfile, keyPeople: [{ name: "张三", title: "经理", focusTracks: ["AI"] }] };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { ...original, version: 5 } })));
    vi.stubGlobal("fetch", fetchMock);
    render(<InvestorProfileEditor investor={original} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑机构档案" }));
    for (const [label, value] of Object.entries({ "公开管理规模 / 体系规模": "50亿元", "投资阶段": "种子、A轮", "细分方向": "模型、芯片", "来源链接": "https://example.com/a/b?q=x,y;z", "核心成员与合伙人": "张三 | 合伙人\n李四", "活跃优先级": "2", "档案状态": "active", "机构类型": "cvc", "英文名称": "Test" })) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "保存档案" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ expectedVersion: 4, priority: 2, status: "active", institutionType: "cvc", englishName: "Test", fundSize: { amount: null, currency: null, text: "50亿元" }, stageFocus: ["种子", "A轮"], subtracks: ["模型", "芯片"], sourceRefs: ["https://example.com/a/b?q=x,y;z"], keyPeople: [{ name: "张三", title: "合伙人", focusTracks: ["AI"] }, { name: "李四", title: null }] });
  });
  it("validates unchanged, malformed and oversized fields before sending and supports cancel", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    render(<InvestorProfileEditor investor={investorProfile} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑机构档案" }));
    fireEvent.click(screen.getByRole("button", { name: "保存档案" }));
    expect(screen.getByRole("alert").textContent).toContain("尚未修改");
    fireEvent.change(screen.getByLabelText("来源链接"), { target: { value: "javascript:evil()" } });
    fireEvent.click(screen.getByRole("button", { name: "保存档案" }));
    expect(screen.getByRole("alert").textContent).toContain("完整的 http");
    fireEvent.change(screen.getByLabelText("来源链接"), { target: { value: "https://example.com/" } });
    fireEvent.change(screen.getByLabelText("核心成员与合伙人"), { target: { value: Array.from({ length: 31 }, (_, index) => `人物${index}`).join("\n") } });
    fireEvent.click(screen.getByRole("button", { name: "保存档案" }));
    expect(screen.getByRole("alert").textContent).toContain("请检查表单");
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "取消修改" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑机构档案" }));
    expect((screen.getByLabelText("来源链接") as HTMLTextAreaElement).value).toBe(investorProfile.sourceRefs.join("\n"));
    fireEvent.click(screen.getByRole("button", { name: "收起编辑" }));
    expect(screen.queryByLabelText("备注")).toBeNull();
  });
  it.each([
    [403, { error: { message: "无权编辑" } }, "无权编辑"],
    [200, { data: {} }, "保存响应异常"],
  ])("handles save response %s without reporting success", async (status, payload, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status })));
    render(<InvestorProfileEditor investor={investorProfile} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑机构档案" }));
    fireEvent.change(screen.getByLabelText("备注"), { target: { value: "新备注" } });
    fireEvent.click(screen.getByRole("button", { name: "保存档案" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(message));
    expect(refresh).not.toHaveBeenCalled();
  });
});
