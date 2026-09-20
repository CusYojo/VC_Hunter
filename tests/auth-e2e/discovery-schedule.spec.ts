import { expect, test } from "@playwright/test";
import { readAuthFixture } from "./fixtures";
import { login } from "./login";

const origin = "http://127.0.0.1:3107";
test("only administrators can persist the twice-daily discovery schedule and uploads remain available", async ({ browser }) => {
  const { admin, member } = readAuthFixture();
  const administrator = await browser.newContext({ baseURL: origin });
  const regular = await browser.newContext({ baseURL: origin });
  const anonymous = await browser.newContext({ baseURL: origin });
  try {
    expect((await anonymous.request.get("/api/v1/discovery/schedule")).status()).toBe(401);
    const page = await administrator.newPage(); await login(page, admin);
    await page.goto("/discover");
    const panel = page.getByRole("region", { name: "AI 定时发现", exact: true });
    await expect(panel.getByText(/10:00.*14:00/)).toBeVisible();
    const initial = (await (await administrator.request.get("/api/v1/discovery/schedule")).json()).data;
    // This fresh fixture has no active scheduled plans; no worker or paid model is started.
    expect(initial.enabled).toBe(false);
    await panel.getByRole("button", { name: "开启定时发现", exact: true }).click();
    await expect(panel.getByText("定时发现已开启", { exact: true })).toBeVisible();
    await page.reload();
    await expect(panel.getByRole("button", { name: "暂停定时发现", exact: true })).toBeVisible();
    const enabled = (await (await administrator.request.get("/api/v1/discovery/schedule")).json()).data;
    expect(enabled).toMatchObject({ enabled: true, timezone: "Asia/Shanghai", times: ["10:00", "14:00"], version: initial.version + 1 });
    const memberPage = await regular.newPage(); await login(memberPage, member);
    await memberPage.goto("/discover");
    await expect(memberPage.getByRole("region", { name: "AI 定时发现", exact: true }).getByText("定时发现已开启", { exact: true })).toBeVisible();
    await expect(memberPage.getByRole("button", { name: "暂停定时发现", exact: true })).toHaveCount(0);
    expect((await regular.request.patch("/api/v1/discovery/schedule", { headers: { origin }, data: { enabled: false, version: enabled.version } })).status()).toBe(403);
    await panel.getByRole("button", { name: "暂停定时发现", exact: true }).click();
    await expect(panel.getByText("定时发现已暂停", { exact: true })).toBeVisible();
    await expect(page.getByLabel("人工上传项目线索", { exact: true })).toBeAttached();
    await page.reload();
    await expect(panel.getByText("定时发现已暂停", { exact: true })).toBeVisible();
    const paused = (await (await administrator.request.get("/api/v1/discovery/schedule")).json()).data;
    expect(paused.enabled).toBe(false); expect(paused.nextRunAt).toBeNull();
  } finally { await administrator.close(); await regular.close(); await anonymous.close(); }
});
