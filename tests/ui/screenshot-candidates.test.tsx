// @vitest-environment jsdom
import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { DiscoveryWorkbench } from "@/components/discovery-workbench";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-04T04:00:00Z")); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("shows screenshot dates, rounds and amounts without inventing valuation, AI scores or source links", () => {
  render(<DiscoveryWorkbench jobs={[]} candidates={[
    { id: "manual1", companyName: "截图芯片", track: "半导体", investorNames: [], signalType: "融资", summary: "待复核截图线索", confidence: null, status: "pending_review", version: 1, lead: { title: "截图存档", url: "manual://screenshot/abc", publishedAt: null }, projectId: null, createdAt: "2026-09-04", origin: "manual_screenshot", eventDate: "2026-09-02", round: "A轮", amountText: "数亿元", valuation: null, sources: [], verificationNotes: "尚未找到独立新闻来源", sourceScreenshot: "截图.png", sourceRow: "1", rawTrack: "半导体", eventType: "融资" },
  ]} />);
  expect(screen.getByText("人工线索")).toBeTruthy();
  expect(screen.getByText("待审核")).toBeTruthy();
  expect(screen.queryByText(/AI \d+%/)).toBeNull();
  expect(screen.getByText("2026-09-02")).toBeTruthy();
  expect(screen.getByText("A轮")).toBeTruthy();
  expect(screen.getByText("数亿元")).toBeTruthy();
  expect(screen.queryByText("估值")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "查看项目详情" }));
  expect(screen.getByText("尚未找到独立新闻来源")).toBeTruthy();
  expect(screen.getByText("暂无可核验的公开来源链接")).toBeTruthy();
  expect(within(screen.getByRole("article")).queryAllByRole("link")).toHaveLength(0);
});

it("preserves the original track and requires classification before explicit review", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { status: "promoted", version: 2, projectId: "p1" } })));
  vi.stubGlobal("fetch", fetchMock);
  render(<DiscoveryWorkbench jobs={[]} candidates={[{ id: "manual2", companyName: "制造线索", track: "待分类", rawTrack: "先进制造", investorNames: [], signalType: "listing", eventType: "listing", summary: "待核验", confidence: null, status: "pending_review", version: 1, lead: { title: "存档", url: "manual://screenshot/a", publishedAt: null }, projectId: null, createdAt: "2026-09-04", origin: "manual_screenshot", sources: [{ title: "真实来源", url: "https://example.com/source", publishedAt: "2026-09-03" }] }]} />);
  expect(screen.getByText("先进制造")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "查看项目详情" }));
  expect(screen.getByRole("link", { name: "真实来源" }).getAttribute("href")).toBe("https://example.com/source");
  fireEvent.click(screen.getByRole("button", { name: "入库" }));
  expect((screen.getByRole("button", { name: "确认入库" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("为制造线索确认赛道"), { target: { value: "半导体" } });
  fireEvent.click(screen.getByRole("button", { name: "确认入库" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ decision: "promote", expectedVersion: 1, track: "半导体" });
});
