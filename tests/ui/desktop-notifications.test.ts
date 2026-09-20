// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopNotificationDelivery, desktopStatus, enableDesktopNotifications, notificationDestination, setDesktopEnabled } from "@/lib/desktop-notifications";

const shown = vi.fn();
const requestPermission = vi.fn();
class FakeNotification {
  static permission = "granted";
  static requestPermission = requestPermission;
  onclick: (() => void) | null = null;
  close = vi.fn();
  constructor(title: string, options: NotificationOptions) { shown(title, options, this); }
}
const item = { id: "one", kind: "task_assigned", message: "你有新任务", projectId: null, targetUrl: "/work?view=tasks", readAt: null, createdAt: "2026-09-04T00:00:00.000Z" };

describe("desktop notification delivery", () => {
  beforeEach(() => {
    localStorage.clear(); shown.mockReset(); requestPermission.mockReset();
    FakeNotification.permission = "granted";
    vi.stubGlobal("Notification", FakeNotification);
    vi.stubGlobal("isSecureContext", true);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("requests permission only when explicitly enabled, and scopes preferences to each account", async () => {
    FakeNotification.permission = "default";
    expect(desktopStatus("alice")).toBe("off");
    expect(requestPermission).not.toHaveBeenCalled();
    requestPermission.mockImplementation(async () => { FakeNotification.permission = "granted"; return "granted"; });
    expect(await enableDesktopNotifications("alice")).toBe("on");
    expect(desktopStatus("bob")).toBe("off");
    setDesktopEnabled("alice", false);
    expect(desktopStatus("alice")).toBe("off");
  });

  it("suppresses initial history and read messages, deduplicates refreshes and other tabs", async () => {
    setDesktopEnabled("alice", true);
    const first = new DesktopNotificationDelivery();
    const second = new DesktopNotificationDelivery();
    await first.deliver("alice", [item], vi.fn());
    await second.deliver("alice", [item], vi.fn());
    expect(shown).not.toHaveBeenCalled();
    const fresh = { ...item, id: "new" };
    await first.deliver("alice", [fresh, item, { ...item, id: "read", readAt: item.createdAt }], vi.fn());
    await first.deliver("alice", [fresh, item], vi.fn());
    await second.deliver("alice", [fresh, item], vi.fn());
    expect(shown).toHaveBeenCalledTimes(1);
    expect(shown).toHaveBeenCalledWith("VC Hunter · 任务分配", expect.objectContaining({ body: item.message }), expect.anything());
  });

  it("opens the destination on click without marking it read just for being displayed", async () => {
    setDesktopEnabled("alice", true);
    const delivery = new DesktopNotificationDelivery();
    const open = vi.fn();
    await delivery.deliver("alice", [], open);
    await delivery.deliver("alice", [item], open);
    expect(open).not.toHaveBeenCalled();
    shown.mock.calls[0][2].onclick();
    expect(open).toHaveBeenCalledWith(item);
  });

  it("cancels queued notifications after switching accounts", async () => {
    let releaseLock: (() => void) | undefined;
    vi.stubGlobal("navigator", { locks: { request: (_key: string, callback: () => void) => new Promise<void>((resolve) => {
      releaseLock = () => { callback(); resolve(); };
    }) } });
    setDesktopEnabled("alice", true);
    const delivery = new DesktopNotificationDelivery();
    await delivery.deliver("alice", [], vi.fn());
    const queued = delivery.deliver("alice", [item], vi.fn());
    await delivery.deliver("bob", [], vi.fn());
    expect(releaseLock).toBeTypeOf("function");
    releaseLock!();
    await queued;
    expect(shown).not.toHaveBeenCalled();
  });

  it("ignores an old account's desktop click after switching accounts", async () => {
    setDesktopEnabled("alice", true);
    const delivery = new DesktopNotificationDelivery();
    const open = vi.fn();
    await delivery.deliver("alice", [], open);
    await delivery.deliver("alice", [item], open);
    const oldNotification = shown.mock.calls[0][2] as FakeNotification;
    await delivery.deliver("bob", [], vi.fn());
    oldNotification.onclick?.();
    expect(open).not.toHaveBeenCalled();
  });

  it("retries failed notifications without repeating the successfully delivered part of a batch", async () => {
    setDesktopEnabled("alice", true);
    const delivery = new DesktopNotificationDelivery();
    await delivery.deliver("alice", [], vi.fn());
    const second = { ...item, id: "second" };
    shown.mockImplementationOnce(() => undefined).mockImplementationOnce(() => { throw new Error("temporary browser failure"); });
    await expect(delivery.deliver("alice", [item, second], vi.fn())).rejects.toThrow("temporary browser failure");
    await delivery.deliver("alice", [item, second], vi.fn());
    const tags = shown.mock.calls.map((call) => call[1].tag);
    expect(tags.filter((tag) => tag === "vc-hunter:alice:one")).toHaveLength(1);
    expect(tags.filter((tag) => tag === "vc-hunter:alice:second")).toHaveLength(2);
  });

  it("handles unsupported contexts, denied permission and storage errors", async () => {
    vi.stubGlobal("isSecureContext", false);
    expect(desktopStatus("alice")).toBe("unsupported");
    expect(await enableDesktopNotifications("alice")).toBe("unsupported");
    vi.stubGlobal("isSecureContext", true);
    FakeNotification.permission = "denied";
    expect(await enableDesktopNotifications("alice")).toBe("denied");
    expect(requestPermission).not.toHaveBeenCalled();
    FakeNotification.permission = "granted";
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(await enableDesktopNotifications("alice")).toBe("unavailable");
    spy.mockRestore();
  });

  it("only permits local application destinations", () => {
    for (const targetUrl of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)"]) {
      expect(notificationDestination({ ...item, targetUrl })).toBe("/work");
    }
    expect(notificationDestination({ ...item, targetUrl: null, projectId: "a/b" })).toBe("/projects/a%2Fb");
    expect(notificationDestination(item)).toBe("/work?view=tasks");
  });
});
