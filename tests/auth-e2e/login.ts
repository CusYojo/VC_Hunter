import { expect, type Page } from "@playwright/test";
import type { TestAccount } from "./fixtures";

export async function login(page: Page, account: TestAccount) {
  await page.goto("/login");
  await page.getByLabel("账号").fill(account.username);
  await page.getByLabel("密码", { exact: true }).fill(account.password);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const [response] = await Promise.all([
      page.waitForResponse((response) => response.url().includes("/api/auth/sign-in/username") && response.request().method() === "POST"),
      page.getByRole("button", { name: "登录工作台", exact: true }).click(),
    ]);
    if (response.status() !== 429) { expect(response.ok()).toBe(true); break; }
    // Preserve the real server login limiter, including when Playwright reloads modules between files.
    const seconds = Number(response.headers()["retry-after"]);
    await new Promise((resolve) => setTimeout(resolve, Math.max(61, Number.isFinite(seconds) ? Math.min(seconds + 1, 65) : 61) * 1000));
  }
  await expect(page).toHaveURL("http://127.0.0.1:3107/");
}
