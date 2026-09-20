import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readAuthFixture } from "./fixtures";
import { login } from "./login";

const origin = "http://127.0.0.1:3107";
const providers = [
  ["openai", "gpt-4.1"], ["claude", "claude-sonnet-4-6"], ["kimi", "kimi-k2.5"],
  ["deepseek", "deepseek-v4-flash"], ["glm", "glm-5"], ["qwen", "qwen-plus"],
] as const;
const fixtureOutput = "隔离测试模型结果：会议已确定资料复核负责人，下一步核验项目来源。";
type SettingsRow = { provider: string; model: string; configured: boolean };

test("personal AI settings, native provider calls, private agents and file-to-result flow use an isolated model fixture", async ({ browser }) => {
  const { admin, member } = readAuthFixture();
  const memberContext = await browser.newContext({ baseURL: origin, acceptDownloads: true });
  const adminContext = await browser.newContext({ baseURL: origin });
  try {
    const page = await memberContext.newPage();
    await login(page, member);
    for (const [provider, model] of providers) {
      const apiKey = `isolated-ai-test-${provider}-member`;
      const response = await memberContext.request.put("/api/v1/settings/ai", { headers: { origin }, data: { provider, model, apiKey, activate: false } });
      expect(response.status()).toBe(200);
      const text = await response.text(); expect(text).not.toContain(apiKey); expect(text).not.toContain("apiKey");
      expect(JSON.parse(text).data.providers.find((row: SettingsRow) => row.provider === provider)).toMatchObject({ configured: true, model });
    }
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "AI 服务与模型" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: /^服务商/ }).locator("option")).toHaveCount(6);
    await page.getByRole("combobox", { name: /^服务商/ }).selectOption("openai");
    await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
    await page.getByRole("button", { name: "保存并使用", exact: true }).click();
    await expect(page.getByText("已保存为当前账号的默认模型。", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("combobox", { name: /^服务商/ })).toHaveValue("openai");
    await expect(page.getByLabel("模型 ID", { exact: true })).toHaveValue("gpt-4.1");
    await page.screenshot({path:"/tmp/vc-ai-settings-e2e.png",fullPage:true,mask:[page.getByLabel("API Key",{exact:true})]});
    await page.getByRole("button", { name: "测试连接", exact: true }).click();
    await expect(page.getByText("连接成功，模型已返回有效响应。", { exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: /^服务商/ }).selectOption("claude");
    await page.getByRole("button", { name: "保存并使用", exact: true }).click();
    await expect(page.getByText("已保存为当前账号的默认模型。", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "测试连接", exact: true }).click();
    await expect(page.getByText("连接成功，模型已返回有效响应。", { exact: true })).toBeVisible();

    await page.goto("/ai?view=studio");
    await page.getByLabel("名称", { exact: true }).fill("E2E私人会议助手");
    await page.getByLabel("任务指令", { exact: true }).fill("核对会议材料并整理责任人与后续行动。");
    await page.getByRole("button", { name: "保存 Agent", exact: true }).click();
    await expect(page.getByText("个人 Agent 已保存，可以在工作台运行。", { exact: true })).toBeVisible();
    await page.reload();
    const agent = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "E2E私人会议助手", exact: true }) });
    await expect(agent).toBeVisible();
    await agent.getByRole("button", { name: "使用", exact: true }).click();
    await page.getByLabel("你的问题或任务", { exact: true }).fill("根据本次会议资料整理复核行动");
    const extraction = page.waitForResponse(response=>response.url().endsWith("/api/v1/ai/extract") && response.request().method()==="POST");
    await page.getByLabel("附加资料", { exact: true }).setInputFiles({ name: "AI会议资料.txt", mimeType: "text/plain", buffer: Buffer.from("会议决定：由张经理核验资料来源，周五前完成。") });
    const extractedResponse = await extraction;
    if (!extractedResponse.ok()) {const payload=await extractedResponse.json();throw new Error(`Local extraction HTTP ${extractedResponse.status()} code ${payload.error?.code}`);}
    await expect(page.getByRole("textbox", { name: /^资料正文（可编辑）/ })).toHaveValue("会议决定：由张经理核验资料来源，周五前完成。");
    await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeDisabled();
    await page.getByRole("checkbox", { name: /同意将本次输入/ }).check();
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect(page.getByText(fixtureOutput, { exact: true })).toBeVisible();
    await page.screenshot({path:"/tmp/vc-ai-result-e2e.png",fullPage:true});
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "下载结果", exact: true }).click()]);
    expect(download.suggestedFilename()).toMatch(/^AI结果-.+\.md$/);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const downloaded = Buffer.concat(chunks).toString("utf8"); expect(downloaded).toContain(fixtureOutput); expect(downloaded).toContain("claude-sonnet-4-6");
    await page.reload();
    await page.getByRole("button", { name: /根据本次会议资料整理复核行动/ }).click();
    await expect(page.getByText(fixtureOutput, { exact: true })).toBeVisible();

    const adminPage = await adminContext.newPage(); await login(adminPage, admin);
    const otherSettings = (await (await adminContext.request.get("/api/v1/settings/ai")).json()).data;
    expect(otherSettings.activeProvider).toBeNull(); expect(otherSettings.providers.every((row: SettingsRow) => !row.configured)).toBe(true);
    expect((await (await adminContext.request.get("/api/v1/ai/templates")).json()).data).toEqual([]);
    expect((await (await adminContext.request.get("/api/v1/ai/runs")).json()).data).toEqual([]);
    expect((await (await adminContext.request.get("/api/v1/ai/conversations")).json()).data).toEqual([]);
    const retained = (await (await memberContext.request.get("/api/v1/settings/ai")).json()).data;
    expect(retained.activeProvider).toBe("claude"); expect(retained.providers.filter((row: SettingsRow) => row.configured)).toHaveLength(6);
    const calls = readFileSync(join(process.env.VC_HUNTER_AUTH_E2E_DIRECTORY!, "model-fixture-calls.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(calls.some((call) => call.provider === "openai" && call.model === "gpt-4.1")).toBe(true);
    expect(calls.filter((call) => call.provider === "claude" && call.nativeClaude)).toHaveLength(2);
  } finally { await memberContext.close(); await adminContext.close(); }
});
