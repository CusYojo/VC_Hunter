// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/app-shell";
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/projects", useRouter: () => ({ push }) }));
vi.mock("@/components/notification-bell", () => ({ NotificationBell: () => null }));
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); Element.prototype.scrollIntoView = vi.fn(); Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) }); });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("global search actual entity results", () => {
  it("finds an actual project and opens it through keyboard selection", async () => {
    const fetcher = vi.fn(async (url: string) => { expect(url).toContain("/api/v1/search?q="); return { ok: true, json: async () => ({ data: { items: [{ id: "p1", type: "project", title: "芯片封装项目", snippet: "先进封装证据", href: "/projects/p1" }] } }) }; });
    vi.stubGlobal("fetch", fetcher); render(<AppShell authenticated><p>内容</p></AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "打开全局搜索" }));
    const input = screen.getByRole("combobox", { name: "搜索项目、机构、人物或功能" });
    fireEvent.change(input, { target: { value: "芯片" } });
    expect(await screen.findByText("芯片封装项目")).toBeTruthy();
    expect(fetcher.mock.calls[0][0]).toBe("/api/v1/search?q=%E8%8A%AF%E7%89%87");
    fireEvent.keyDown(input, { key: "ArrowDown" }); fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/projects/p1"));
  });
  it("aborts stale requests and shows a readable API error", async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { signals.push(init.signal as AbortSignal); return { ok: false, json: async () => ({ error: { message: "搜索暂不可用" } }) }; }));
    render(<AppShell authenticated><p>内容</p></AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "打开全局搜索" }));
    const input = screen.getByRole("combobox", { name: "搜索项目、机构、人物或功能" });
    fireEvent.change(input, { target: { value: "旧搜索" } });
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.change(input, { target: { value: "新搜索" } });
    expect(signals[0].aborted).toBe(true);
    expect((await screen.findByRole("alert")).textContent).toBe("搜索暂不可用");
  });
});
