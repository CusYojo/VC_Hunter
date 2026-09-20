// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvestorDirectory } from "@/components/investor-directory";
import { investorProfile } from "../fixtures/investor-profile";

describe("institution directory", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("shows institutional scale and labels evidence counts, not total investment activity", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { items: [investorProfile], total: 1 } }))));
    render(<InvestorDirectory initial={[investorProfile]} total={1} />);
    expect(screen.getByText("未统一公开")).toBeTruthy();
    expect(screen.getByText(/已关联投资记录/)).toBeTruthy();
    expect(screen.queryByText("出手")).toBeNull();
    expect(screen.getByRole("link", { name: /测试创投/ }).getAttribute("href")).toBe("/investors/inv-test");
  });
  it("filters with API and reports fetch failures while keeping the current cards", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    render(<InvestorDirectory initial={[investorProfile]} total={61} />);
    fireEvent.change(screen.getByLabelText("搜索机构"), { target: { value: "测试" } });
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("query=%E6%B5%8B%E8%AF%95");
    expect(screen.getByText("测试创投")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
  });
  it("sends all filters, pages results and resets the page when a filter changes", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ data: { items: [investorProfile], total: 61 } })));
    vi.stubGlobal("fetch", fetchMock);
    render(<InvestorDirectory initial={[investorProfile]} total={61} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("page=2"));
    fireEvent.click(screen.getByRole("button", { name: "上一页" }));
    await waitFor(() => expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("page=1"));
    for (const [label, value] of Object.entries({ "机构类型": "cvc", "赛道": "AI", "优先级": "1", "状态": "verified" })) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    await waitFor(() => expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("type=cvc&track=AI&priority=1&status=verified"));
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("page=1");
  });
  it("shows an explicit empty result and retries failed HTTP responses", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "无权限" } }), { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { items: [], total: 0 } })));
    vi.stubGlobal("fetch", fetchMock);
    render(<InvestorDirectory initial={[]} total={0} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("无权限"));
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByText("没有匹配的机构")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "下一页" })).toBeNull();
  });
  it("shows unknown optional fields and safely rejects malformed responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { items: "bad" } }))));
    render(<InvestorDirectory initial={[{ ...investorProfile, englishName: "Test VC", headquarters: null, institutionType: "custom", status: "custom", focusTracks: [], fundSize: null, investmentStyle: "早期硬科技" }]} total={1} />);
    expect(screen.getByText("赛道未分类")).toBeTruthy();
    expect(screen.getByText("早期硬科技")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("返回格式异常"));
  });
  it("does not let an older response overwrite a newer search", async () => {
    const pending: ((response: Response) => void)[] = [];
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => pending.push(resolve)));
    vi.stubGlobal("fetch", fetchMock);
    render(<InvestorDirectory initial={[investorProfile]} total={1} />);
    await waitFor(() => expect(pending).toHaveLength(1));
    fireEvent.change(screen.getByLabelText("搜索机构"), { target: { value: "新搜索" } });
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => pending[1](new Response(JSON.stringify({ data: { items: [{ ...investorProfile, name: "新搜索结果" }], total: 1 } }))));
    await act(async () => pending[0](new Response(JSON.stringify({ data: { items: [investorProfile], total: 1 } }))));
    expect(screen.getByText("新搜索结果")).toBeTruthy();
    expect(screen.queryByText("测试创投")).toBeNull();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });
});
