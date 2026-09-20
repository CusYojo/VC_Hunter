// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/app-shell";
import { PROTOTYPE_STORAGE_KEY } from "@/prototype/store-core";

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/components/notification-bell", () => ({
  NotificationBell: () => <button type="button" aria-label="通知中心">通知</button>,
}));

describe("VC OS AppShell", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("shows separate task and calendar destinations and reveals the remaining features on demand", () => {
    render(<AppShell authenticated><p>页面内容</p></AppShell>);

    expect(screen.getByText("工作空间")).toBeTruthy();
    expect(screen.getByText("投资运营 OS")).toBeTruthy();
    const sidebar = within(screen.getByRole("navigation", { name: "业务中心" }));
    const mobile = within(screen.getByRole("navigation", { name: "移动端导航" }));
    const mainLabels = ["工作台", "项目管理", "我的待办", "日程表", "资料审批", "AI 工作台"];
    expect(sidebar.getAllByRole("link").map(link => link.textContent)).toEqual(mainLabels);
    expect(mobile.getAllByRole("link").map(link => link.textContent)).toEqual(mainLabels);
    expect(sidebar.getByRole("link", { name: "项目管理" }).getAttribute("aria-current")).toBe("page");
    const more = sidebar.getByRole("button", { name: "更多功能" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(sidebar.queryByRole("link", { name: "新项目发现" })).toBeNull();
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(sidebar.getByRole("link", { name: "新项目发现" })).toBeTruthy();
    expect(sidebar.getByRole("link", { name: "财务中心" })).toBeTruthy();
    fireEvent.click(more);
    expect(sidebar.getAllByRole("link")).toHaveLength(6);
  });

  it("switches the demo persona and persists it without changing backend permissions", () => {
    render(<AppShell><p>页面内容</p></AppShell>);
    const personaSelect = screen.getByLabelText("演示角色");

    expect(personaSelect.querySelectorAll("option")).toHaveLength(10);
    fireEvent.change(personaSelect, { target: { value: "finance" } });

    expect((personaSelect as HTMLSelectElement).value).toBe("finance");
    expect(JSON.parse(localStorage.getItem(PROTOTYPE_STORAGE_KEY) ?? "{}").persona).toBe("finance");
    expect(screen.getByText("演示视图，不改变服务端权限")).toBeTruthy();
  });

  it("provides keyboard-accessible global search entry", () => {
    render(<AppShell><p>页面内容</p></AppShell>);

    fireEvent.click(screen.getByRole("button", { name: "打开全局搜索" }));

    expect(screen.getByRole("dialog", { name: "全局搜索" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "搜索项目、机构、人物或功能" })).toBeTruthy();
  });
  it("ignores administrator job labels and renders management only with the server capability", () => {
    const user = { id: "m1", name: "张明", role: "管理员", capabilities: [] };
    const { rerender } = render(<AppShell authenticated user={user}><p>内容</p></AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "更多功能" }));
    expect(screen.getByRole("link", { name: "组织架构" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "人员管理" })).toBeNull();
    rerender(<AppShell authenticated user={user} canManageOrganization><p>内容</p></AppShell>);
    expect(screen.getByRole("link", { name: "人员管理" })).toBeTruthy();
  });
});
