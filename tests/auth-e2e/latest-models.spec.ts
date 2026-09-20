import { test, expect } from "@playwright/test";
import { readAuthFixture } from "./fixtures";
import { login } from "./login";
const origin = "http://127.0.0.1:3107";
test("saved accounts can switch to all GPT 5.6 tiers through the model picker", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: origin });
  try {
    const page = await context.newPage(); await login(page, readAuthFixture().admin);
    const setup = await context.request.put("/api/v1/settings/ai", { headers: { origin }, data: { provider: "openai", model: "gpt-4.1", apiKey: "isolated-ai-test-openai-current-models", activate: true } });
    expect(setup.status()).toBe(200);
    await page.goto("/settings");
    await expect(page.getByLabel("模型 ID", { exact: true })).toHaveValue("gpt-4.1");
    for (const model of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
      await page.getByLabel("常用模型", { exact: true }).selectOption(model,{timeout:5000});
      await expect(page.getByLabel("模型 ID", { exact: true })).toHaveValue(model);
      const [saved] = await Promise.all([page.waitForResponse(r => r.url().endsWith("/api/v1/settings/ai") && r.request().method() === "PUT"), page.getByRole("button", { name: "保存并使用", exact: true }).click()]);
      expect(saved.status()).toBe(200);
      const [checked] = await Promise.all([page.waitForResponse(r => r.url().endsWith("/api/v1/settings/ai/test")), page.getByRole("button", { name: "测试连接", exact: true }).click()]);
      expect(checked.status()).toBe(200);
      expect((await checked.json()).data).toMatchObject({ connected: true, provider: "openai", model });
    }
    await page.reload();
    await expect(page.getByLabel("常用模型", { exact: true })).toHaveValue("gpt-5.6-luna");
    await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
    await page.screenshot({ path: "/tmp/vc-latest-model-settings.png", mask: [page.getByLabel("API Key", { exact: true })] });
  } finally { await context.close(); }
});
