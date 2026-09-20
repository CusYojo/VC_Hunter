import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { ChatTurn } from "../../src/ai/chat-contracts";
import { readAuthFixture } from "./fixtures";
import { login } from "./login";

const origin = "http://127.0.0.1:3107";
const projectA = "project-qiongxin";
const projectB = "project-yaoshi";
const sourceA = "对话项目甲独有证据：样机验证负责人是周工，交付日期为十月十五日。";
const sourceB = "对话项目乙独有证据：试生产负责人是陈工，交付日期为十一月二日。";
async function upload(context: BrowserContext, id: string, text: string) {
  const project = (await (await context.request.get(`/api/v1/projects/${id}`)).json()).data;
  const response = await context.request.post(`/api/v1/projects/${id}/documents`, {
    headers: { origin, "idempotency-key": randomUUID() },
    multipart: { file: { name: `${id}-对话验证.txt`, mimeType: "text/plain", buffer: Buffer.from(text) }, expectedVersion: String(project.version), externalPolicy: "local_only" },
  });
  expect(response.status()).toBe(201);
}
async function ask(page: Page, question: string, retried = false): Promise<ChatTurn> {
  await page.getByLabel("你的问题或任务", { exact: true }).fill(question);
  await page.getByRole("checkbox", { name: /同意将本次输入/ }).check();
  const [response] = await Promise.all([
    page.waitForResponse(response => /\/ai\/conversations\/[^/]+\/messages$/.test(new URL(response.url()).pathname) && response.request().method() === "POST"),
    page.getByRole("button", { name: "发送消息", exact: true }).click(),
  ]);
  const payload = await response.json();
  if (response.status() === 429 && !retried) {
    await page.waitForTimeout(61_000);
    return ask(page, question, true);
  }
  if (response.status() !== 200) throw new Error(`Chat HTTP ${response.status()} code ${payload.error?.code ?? "unknown"}, question ${question.slice(0, 12)}`);
  return payload.data;
}

test("chat persists private follow-ups and retrieves only the selected project when enabled", async ({ browser }) => {
  test.setTimeout(180_000);
  const { admin, member } = readAuthFixture();
  const context = await browser.newContext({ baseURL: origin });
  const other = await browser.newContext({ baseURL: origin });
  try {
    const page = await context.newPage(); await login(page, admin);
    expect((await context.request.put("/api/v1/settings/ai", { headers: { origin }, data: { provider: "openai", model: "gpt-5.6-sol", apiKey: "isolated-ai-test-openai-chat", activate: true } })).status()).toBe(200);
    await upload(context, projectA, sourceA); await upload(context, projectB, sourceB);
    await page.goto("/ai");
    await expect(page.getByRole("button", { name: "新建对话", exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "查询知识库", exact: true })).not.toBeChecked();
    await expect(page.getByRole("combobox", { name: "选择项目", exact: true })).toHaveCount(0);
    await page.screenshot({ path: "/tmp/vc-chat-empty.png", fullPage: true });
    const first = await ask(page, "对话验证第一轮：记住会议负责人是林工。");
    expect(first.output).toBe("已记住会议负责人是林工。"); expect(first.sources).toEqual([]);
    const second = await ask(page, "对话验证第二轮：刚才指定了谁？");
    expect(second.conversationId).toBe(first.conversationId);
    expect(second.output).toBe("刚才指定的会议负责人是林工。");
    await page.getByRole("checkbox", { name: "查询知识库", exact: true }).check();
    await page.getByLabel("你的问题或任务", { exact: true }).fill("对话验证项目甲：样机负责人和交付日期是什么？");
    await page.getByRole("checkbox", { name: /同意将本次输入/ }).check();
    await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeDisabled();
    await page.getByRole("combobox", { name: "选择项目", exact: true }).selectOption(projectA);
    await expect(page.getByRole("checkbox", { name: /同意将本次输入/ })).not.toBeChecked();
    const third = await ask(page, "对话验证项目甲：样机负责人和交付日期是什么？");
    expect(third.projectId).toBe(projectA); expect(third.useKnowledge).toBe(true);
    expect(third.output).toBe("周工负责样机验证，十月十五日交付。[S1]");
    expect(third.sources).toEqual(expect.arrayContaining([expect.objectContaining({ title: `${projectA}-对话验证.txt` })]));
    await expect(page.getByRole("link", { name: new RegExp(`${projectA}-对话验证.txt`) })).toBeVisible();
    await page.getByRole("checkbox", { name: "查询知识库", exact: true }).uncheck();
    const fourth = await ask(page, "对话验证关闭知识：只根据普通对话回答会议负责人。");
    expect(fourth.useKnowledge).toBe(false); expect(fourth.projectId).toBeNull(); expect(fourth.sources).toEqual([]);
    expect(fourth.output).toBe("当前普通对话上下文没有会议负责人信息，请重新提供。");
    await page.getByRole("checkbox", { name: "查询知识库", exact: true }).check();
    await page.getByRole("combobox", { name: "选择项目", exact: true }).selectOption(projectB);
    const fifth = await ask(page, "对话验证项目乙：试生产负责人和交付日期是什么？");
    expect(fifth.projectId).toBe(projectB); expect(fifth.output).toBe("陈工负责试生产，十一月二日交付。[S1]");
    const detail = await context.request.get(`/api/v1/ai/conversations/${first.conversationId}`);
    expect(detail.status()).toBe(200); expect((await detail.json()).data.turns).toHaveLength(5);
    await page.screenshot({ path: "/tmp/vc-chat-desktop.png", fullPage: true });
    await page.reload();
    await page.getByRole("button", { name: /对话验证第一轮/ }).click();
    await expect(page.getByText(second.output, { exact: true })).toBeVisible();
    await expect(page.getByText(fifth.output, { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeVisible();
    await page.screenshot({ path: "/tmp/vc-chat-mobile.png", fullPage: true });
    await login(await other.newPage(), member);
    expect((await other.request.get(`/api/v1/ai/conversations/${first.conversationId}`)).status()).toBe(404);
    const otherRows = (await (await other.request.get("/api/v1/ai/conversations")).json()).data as { id: string }[];
    expect(otherRows.some(row => row.id === first.conversationId)).toBe(false);
  } finally { await context.close(); await other.close(); }
});
