// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationBell } from "@/components/notification-bell";
import { DesktopNotificationDelivery, type InboxNotification } from "@/lib/desktop-notifications";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
}));

const notification = {
  id: "notification-1",
  kind: "milestone_assigned",
  projectId: "project-1",
  projectName: "边界机器人",
  milestoneId: "milestone-1",
  message: "项目需要复核",
  readAt: null,
  createdAt: "2026-09-03T00:00:00.000Z",
};

describe("NotificationBell", () => {
  afterEach(() => {
    navigation.push.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    localStorage.clear();
  });

  it("loads the unread count after mounting", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { items: [notification], unread: 1 } }), { status: 200 })));

    render(<NotificationBell />);

    expect(await screen.findByRole("button", { name: "提醒（1 条未读）" })).toBeTruthy();
  });

  it("marks a notification as read and navigates with the App Router", async () => {
    let readAt: string | null = null;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") { readAt = new Date().toISOString(); return Response.json({ data: { ...notification, readAt, unread: 0 } }); }
      return Response.json({ data: { items: [{ ...notification, readAt }], unread: readAt ? 0 : 1 } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<NotificationBell />);

    fireEvent.click(await screen.findByRole("button", { name: "提醒（1 条未读）" }));
    fireEvent.click(await screen.findByRole("button", { name: /项目需要复核/ }));

    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/projects/project-1"));
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/notifications/notification-1", expect.objectContaining({ method: "PATCH" }));
  });

  it("keeps the unread count and reports a failed read update", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "PATCH" ? new Response("{}", { status: 500 }) : Response.json({ data: { items: [notification], unread: 1 } })));
    render(<NotificationBell />);
    fireEvent.click(await screen.findByRole("button", { name: "提醒（1 条未读）" }));
    fireEvent.click(await screen.findByRole("button", { name: /项目需要复核/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("标记已读失败");
    expect(screen.getByRole("button", { name: "提醒（1 条未读）" })).toBeTruthy();
  });

  it("marks only the inbox snapshot as read and follows a task destination", async () => {
    const snapshotAt = "2026-09-04T00:00:00.000Z";
    let readAt: string | null = null;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") { readAt = snapshotAt; return Response.json({ data: { updated: 1 } }); }
      return Response.json({ data: { items: [{ ...notification, readAt, projectId: null, targetUrl: "/work?view=tasks" }], unread: readAt ? 0 : 1, snapshotAt } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<NotificationBell />);
    fireEvent.click(await screen.findByRole("button", { name: "提醒（1 条未读）" }));
    fireEvent.click(await screen.findByRole("button", { name: "全部已读" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/v1/notifications", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ before: snapshotAt }) })));
    fireEvent.click(screen.getByRole("button", { name: /项目需要复核/ }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/work?view=tasks"));
  });

  it("keeps the authoritative unread count when a stale desktop notification is clicked after it was read", async () => {
    let openDesktop: ((item: InboxNotification) => void) | undefined;
    vi.spyOn(DesktopNotificationDelivery.prototype, "deliver").mockImplementation(async (_recipient, _items, open) => { openDesktop ??= open; });
    vi.spyOn(window, "focus").mockImplementation(() => undefined);
    let readAt: string | null = null;
    const other = { ...notification, id: "notification-2", message: "另一条未读提醒" };
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") { readAt ??= new Date().toISOString(); return Response.json({ data: { ...notification, readAt, unread: 1 } }); }
      return Response.json({ data: { items: [{ ...notification, readAt }, other], unread: readAt ? 1 : 2, recipientId: "alice" } });
    }));
    render(<NotificationBell />);
    fireEvent.click(await screen.findByRole("button", { name: "提醒（2 条未读）" }));
    fireEvent.click(await screen.findByRole("button", { name: /项目需要复核/ }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("button", { name: "提醒（1 条未读）" })).toBeTruthy();
    expect(openDesktop).toBeTypeOf("function");
    await act(async () => { openDesktop!(notification); });
    await waitFor(() => expect(navigation.push).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "提醒（1 条未读）" })).toBeTruthy();
  });

  it("refreshes on window focus and closes on Escape", async () => {
    let fresh = false;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: { items: fresh ? [notification] : [], unread: fresh ? 1 : 0 } })));
    render(<NotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: "提醒（0 条未读）" }));
    await screen.findByText("暂无提醒");
    fresh = true;
    fireEvent.focus(window);
    expect(await screen.findByRole("button", { name: "提醒（1 条未读）" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "通知中心" })).toBeNull();
    expect(screen.getByRole("button", { name: "提醒（1 条未读）" })).toHaveAttribute("aria-expanded", "false");
  });

  it.each(["granted", "denied", "default"] as const)("handles a %s response to the desktop permission prompt", async permission => {
    const api = { permission: "default", requestPermission: vi.fn(async () => { api.permission = permission; return permission; }) };
    vi.stubGlobal("Notification", api);
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: { items: [], unread: 0, recipientId: "alice" } })));
    render(<NotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: "提醒（0 条未读）" }));
    const enable = await screen.findByRole("button", { name: "开启桌面通知" });
    await waitFor(() => expect(enable).toBeEnabled());
    expect(api.requestPermission).not.toHaveBeenCalled();
    fireEvent.click(enable);
    await waitFor(() => expect(api.requestPermission).toHaveBeenCalledTimes(1));
    if (permission === "granted") {
      fireEvent.click(await screen.findByRole("button", { name: "关闭桌面通知" }));
      expect(await screen.findByRole("button", { name: "开启桌面通知" })).toBeEnabled();
      expect(localStorage.getItem("vc-hunter:desktop:alice")).toBe("off");
    } else if (permission === "denied") {
      expect(await screen.findByText(/桌面通知被浏览器阻止/)).toBeTruthy();
      expect(screen.getByRole("button", { name: "开启桌面通知" })).toBeDisabled();
    } else {
      await waitFor(() => expect(screen.getByRole("button", { name: "开启桌面通知" })).toBeEnabled());
      expect(localStorage.getItem("vc-hunter:desktop:alice")).toBeNull();
    }
  });

  it("filters read notifications and restores them when viewing all", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: { items: [{ ...notification, readAt: notification.createdAt }], unread: 0 } })));
    render(<NotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: "提醒（0 条未读）" }));
    expect(await screen.findByText("项目需要复核")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "只看未读" }));
    expect(screen.queryByText("项目需要复核")).toBeNull();
    expect(screen.getByText("没有未读提醒")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "查看全部" }));
    expect(screen.getByText("项目需要复核")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("region", { name: "通知中心" })).toBeNull();
  });

  it("allows retry after a network failure and recovers on reconnect", async () => {
    let available = false;
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (!available) throw new TypeError("offline");
      return Response.json({ data: { items: [notification], unread: 1 } });
    }));
    render(<NotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: "提醒（0 条未读）" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("通知暂时无法更新");
    fireEvent.click(screen.getByRole("button", { name: "刷新通知" }));
    expect(screen.getByRole("alert")).toBeTruthy();
    available = true;
    fireEvent(window, new Event("online"));
    expect(await screen.findByRole("button", { name: "提醒（1 条未读）" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps unread state and reports a failed bulk read", async () => {
    let bulkAttempted = false;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") { bulkAttempted = true; return new Response("{}", { status: 500 }); }
      if (bulkAttempted) return new Promise<Response>(() => undefined);
      return Response.json({ data: { items: [notification], unread: 1, snapshotAt: "2026-09-04T00:00:00.000Z" } });
    }));
    render(<NotificationBell />);
    fireEvent.click(await screen.findByRole("button", { name: "提醒（1 条未读）" }));
    fireEvent.click(screen.getByRole("button", { name: "全部已读" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("全部标记已读失败");
    expect(screen.getByRole("button", { name: "提醒（1 条未读）" })).toBeTruthy();
    expect(screen.getByLabelText("未读")).toBeTruthy();
  });

  it.each([401, 403])("clears old account notifications after a %s response", async status => {
    let unauthorized = false;
    const reset = vi.spyOn(DesktopNotificationDelivery.prototype, "reset");
    vi.stubGlobal("fetch", vi.fn(async () => unauthorized ? new Response("{}", { status }) : Response.json({ data: { items: [notification], unread: 1, recipientId: "alice" } })));
    render(<NotificationBell />);
    fireEvent.click(await screen.findByRole("button", { name: "提醒（1 条未读）" }));
    expect(await screen.findByText("项目需要复核")).toBeTruthy();
    reset.mockClear(); unauthorized = true;
    fireEvent.focus(window);
    expect(await screen.findByRole("alert")).toHaveTextContent("通知暂时无法更新");
    expect(screen.queryByText("项目需要复核")).toBeNull();
    expect(screen.getByRole("button", { name: "提醒（0 条未读）" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "开启桌面通知" })).toBeDisabled();
    expect(reset).toHaveBeenCalled();
  });

  it("polls for new notifications and cancels polling after unmount", async () => {
    vi.useFakeTimers();
    let fresh = false;
    const fetchMock = vi.fn(async () => Response.json({ data: { items: fresh ? [notification] : [], unread: fresh ? 1 : 0 } }));
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = render(<NotificationBell />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByRole("button", { name: "提醒（0 条未读）" })).toBeTruthy();
    fresh = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.getByRole("button", { name: "提醒（1 条未读）" })).toBeTruthy();
    unmount();
    const calls = fetchMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });
});
