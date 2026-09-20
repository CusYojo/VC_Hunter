import { test, expect } from "@playwright/test";
import { readAuthFixture } from "./fixtures";
import { login } from "./login";

test("manual discovery retains original uploaded document after confirmation and reload", async ({ page }) => {
  await login(page, readAuthFixture().admin);
  await page.goto("/discover");
  const content = "真实上传验证：项目研究资料原件应可完整下载。";
  const extraction = page.waitForResponse(response=>response.url().endsWith("/api/v1/ai/extract") && response.request().method()==="POST");
  await page.getByLabel("人工上传项目线索", { exact: true }).setInputFiles({ name: "上传验证.txt", mimeType: "text/plain", buffer: Buffer.from(content) });
  await expect(page.getByRole("dialog", { name: "确认导入线索" })).toBeVisible();
  const extractedResponse = await extraction;
  if (!extractedResponse.ok()) {const payload=await extractedResponse.json();throw new Error(`Local extraction HTTP ${extractedResponse.status()} code ${payload.error?.code}`);}
  await expect(page.getByRole("textbox", { name: /^线索摘要/ })).toHaveValue(content);
  await page.getByLabel("项目名称", { exact: true }).fill("E2E上传验证项目");
  await page.getByRole("button", { name: "确认线索并保存", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "确认导入线索" })).toHaveCount(0);
  await page.reload();
  const card = page.getByRole("article").filter({ hasText: "E2E上传验证项目" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "查看项目详情" }).click();
  const url = await card.getByRole("link", { name: "下载原始资料：上传验证.txt" }).getAttribute("href");
  const response = await page.request.get(url!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-disposition"]).toContain("attachment");
  expect(await response.text()).toBe(content);
});
