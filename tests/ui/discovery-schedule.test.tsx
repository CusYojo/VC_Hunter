// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DiscoveryScheduleControls } from "@/components/discovery-schedule-controls";
afterEach(() => vi.unstubAllGlobals());
const schedule = { enabled: false, version: 1, timezone: "Asia/Shanghai", times: ["10:00", "14:00"], nextRunAt: null, planCount: 7, updatedAt: "2026-09-04T00:00:00Z" };
it("lets administrators enable fixed-time discovery using the stored version", async () => {
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => ({ ok: true, json: async () => ({ data: init?.method ? { ...schedule, enabled: true, version: 2, nextRunAt: "2026-09-04T06:00:00Z" } : schedule }) }));
  vi.stubGlobal("fetch", fetcher); render(<DiscoveryScheduleControls canAdmin />);
  fireEvent.click(await screen.findByRole("button", { name: "开启定时发现" }));
  expect(await screen.findByRole("button", { name: "暂停定时发现" })).toBeVisible();
  expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toEqual({ enabled: true, version: 1 });
  expect(screen.getByText(/10:00.*14:00/)).toBeVisible();
});
it("shows schedule status to members without giving them configuration controls", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: schedule }) })));
  render(<DiscoveryScheduleControls canAdmin={false} />);
  expect(await screen.findByText("定时发现已暂停")).toBeVisible();
  expect(screen.queryByRole("button", { name: "开启定时发现" })).not.toBeInTheDocument();
});
it("preserves paused status on a failed update and reports the failure", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => ({ ok: !init?.method, json: async () => init?.method ? { error: { message: "设置已更新，请刷新。" } } : { data: schedule } })));
  render(<DiscoveryScheduleControls canAdmin />);
  fireEvent.click(await screen.findByRole("button", { name: "开启定时发现" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("设置已更新，请刷新。");
  expect(screen.getByRole("button", { name: "开启定时发现" })).toBeEnabled();
});
it("recovers from an initial load failure with an explicit refresh", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: false, json: async () => ({}) }).mockResolvedValueOnce({ ok: true, json: async () => ({ data: schedule }) });
  vi.stubGlobal("fetch", fetcher); render(<DiscoveryScheduleControls canAdmin />);
  expect(await screen.findByRole("alert")).toHaveTextContent("定时发现状态读取失败。");
  fireEvent.click(screen.getByRole("button", { name: "刷新定时发现状态" }));
  expect(await screen.findByText("定时发现已暂停")).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("keeps the last known status when refreshing fails", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ data: schedule }) }).mockRejectedValueOnce("offline"));
  render(<DiscoveryScheduleControls canAdmin={false} />);
  await screen.findByText("定时发现已暂停");
  fireEvent.click(screen.getByRole("button", { name: "刷新定时发现状态" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("读取失败，请刷新重试。");
  expect(screen.getByText("定时发现已暂停")).toBeVisible();
});
it("shows when an enabled schedule has no plans and leaves state intact on network failure", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ data: { ...schedule, enabled: true, planCount: 0 } }) }).mockRejectedValueOnce("offline"));
  render(<DiscoveryScheduleControls canAdmin />);
  await screen.findByText("暂无启用的搜索计划，请联系管理员。");
  fireEvent.click(screen.getByRole("button", { name: "暂停定时发现" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("保存失败，请刷新后重试。");
  expect(screen.getByRole("button", { name: "暂停定时发现" })).toBeEnabled();
});
