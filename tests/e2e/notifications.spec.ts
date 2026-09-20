import { expect, test } from "@playwright/test";
import { readAuthFixture } from "../auth-e2e/fixtures";

test.beforeEach(async ({ page, baseURL }) => {
  if (!process.env.VC_HUNTER_AUTH_E2E_DIRECTORY) return;
  const { admin } = readAuthFixture();
  const response = await page.request.post(`${baseURL}/api/auth/sign-in/username`, {
    headers: { origin: baseURL! }, data: { username: admin.username, password: admin.password },
  });
  expect(response.ok()).toBe(true);
});

test("notification center receives new work, delivers desktop reminders once and marks the inbox read", async ({ page }) => {
  await page.addInitScript(() => {
    const messages: Array<{ title: string; onclick: (() => void) | null }> = [];
    Object.defineProperty(window, "__desktopMessages", { value: messages });
    class BrowserNotification {
      static permission = "default";
      static async requestPermission() { this.permission = "granted"; return "granted"; }
      onclick: (() => void) | null = null;
      constructor(public title: string) { messages.push(this); }
      close() {}
    }
    Object.defineProperty(window, "Notification", { value: BrowserNotification });
  });
  const snapshotAt = "2026-09-04T01:00:00.000Z";
  let items = [{ id: "history", kind: "task_assigned", projectId: null, targetUrl: "/work?view=tasks", message: "已有任务", readAt: null as string | null, createdAt: "2026-09-04T00:00:00.000Z" }];
  await page.route("**/api/v1/notifications**", async (route) => {
    const request = route.request();
    if (request.method() === "PATCH") {
      expect(request.postDataJSON()).toEqual({ before: snapshotAt });
      items = items.map((item) => ({ ...item, readAt: snapshotAt }));
      await route.fulfill({ json: { data: { updated: items.length } } });
    } else await route.fulfill({ json: { data: { items, unread: items.filter((item) => !item.readAt).length, recipientId: "e2e-notifications", snapshotAt } } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "提醒（1 条未读）" }).click();
  const center = page.getByRole("region", { name: "通知中心" });
  await expect(center.getByText("已有任务")).toBeVisible();
  await center.getByRole("button", { name: "开启桌面通知" }).click();
  await expect(center.getByRole("button", { name: "关闭桌面通知" })).toBeVisible();
  items = [{ ...items[0], id: "new-approval", kind: "approval_requested", targetUrl: "/approvals", message: "请审批新的立项申请" }, ...items];
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("button", { name: "提醒（2 条未读）" })).toBeVisible();
  await expect(center.getByText("请审批新的立项申请")).toBeVisible();
  const desktopMessages = () => page.evaluate(() => (window as unknown as { __desktopMessages: Array<{ title: string }> }).__desktopMessages.map((item) => item.title));
  await expect.poll(desktopMessages).toEqual(["VC Hunter · 待我审批"]);
  await center.getByRole("button", { name: "刷新通知" }).click();
  await expect.poll(desktopMessages).toEqual(["VC Hunter · 待我审批"]);
  await center.getByRole("button", { name: "全部已读" }).click();
  await expect(page.getByRole("button", { name: "提醒（0 条未读）" })).toBeVisible();
  await center.getByRole("button", { name: "只看未读" }).click();
  await expect(center.getByText("没有未读提醒")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(center).toBeHidden();
});

test("notification center remains accessible on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/v1/notifications?**", (route) => route.fulfill({ json: { data: { items: [], unread: 0, recipientId: "mobile-user", snapshotAt: new Date().toISOString() } } }));
  await page.goto("/");
  await page.getByRole("button", { name: "提醒（0 条未读）" }).click();
  const center = page.getByRole("region", { name: "通知中心" });
  await expect(center).toBeVisible();
  const bounds = await center.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await expect(center.getByText("暂无提醒")).toBeVisible();
});
