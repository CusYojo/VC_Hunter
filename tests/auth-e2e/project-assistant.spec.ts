import { test, expect } from "@playwright/test";
import { readAuthFixture } from "./fixtures";
import { login } from "./login";

const origin = "http://127.0.0.1:3107";
const projectId = "project-qiongxin";
const fileName = "项目知识问答验证.txt";
const documentText = "本项目专属验证资料：工程样机已于六月完成验证，下一步进行可靠性测试。";
const question = "项目知识问答验证：工程样机验证进度与下一步是什么？";
const answer = "工程样机已于六月完成验证，下一步进行可靠性测试。[S1]";

test("project knowledge upload grounds a private assistant answer in this project's source document", async ({ browser }) => {
  const { admin, member } = readAuthFixture();
  const authorContext = await browser.newContext({ baseURL: origin });
  const otherContext = await browser.newContext({ baseURL: origin });
  try {
    const page = await authorContext.newPage();
    await login(page, admin);
    const settings = await authorContext.request.put("/api/v1/settings/ai", { headers: { origin }, data: { provider: "openai", model: "gpt-4.1", apiKey: "isolated-ai-test-openai-project", activate: true } });
    expect(settings.status()).toBe(200);
    await page.goto(`/projects/${projectId}`);
    await page.getByRole("tab", { name: "项目知识库", exact: true }).click();
    await expect(page.getByRole("heading", { name: "项目专属 AI 工作助手", exact: true })).toBeVisible();
    await page.getByLabel("知识库文件", { exact: true }).setInputFiles({ name: fileName, mimeType: "text/plain", buffer: Buffer.from(documentText) });
    const [uploadResponse] = await Promise.all([
      page.waitForResponse((response) => response.url().includes(`/projects/${projectId}/documents`) && response.request().method() === "POST"),
      page.getByRole("button", { name: "上传到知识库", exact: true }).click(),
    ]);
    expect(uploadResponse.status()).toBe(201);
    await page.getByLabel("项目问题", { exact: true }).fill(question);
    const submit = page.getByRole("button", { name: "基于项目知识回答", exact: true });
    await expect(submit).toBeDisabled();
    await page.getByLabel("同意将本次问题及检索到的项目资料发送至我的默认模型服务商。", { exact: true }).check();
    const [response] = await Promise.all([
      page.waitForResponse((response) => response.url().includes(`/projects/${projectId}/assistant`) && response.request().method() === "POST"),
      submit.click(),
    ]);
    expect(response.status()).toBe(200);
    const returned = (await response.json()).data;
    expect(returned.status).toBe("succeeded");
    expect(returned.sources).toEqual(expect.arrayContaining([expect.objectContaining({ title: fileName, reference: "S1", type: "document" })]));
    await expect(page.getByText(answer, { exact: true })).toBeVisible();
    const citation = page.getByRole("article", { name: "项目助手回答", exact: true }).getByRole("link", { name: `[S1] ${fileName}`, exact: true });
    await expect(citation).toBeVisible();
    const citationUrl = await citation.getAttribute("href");
    expect(citationUrl).toContain(`/api/v1/projects/${projectId}/documents/`);
    const source = await authorContext.request.get(citationUrl!);
    expect(source.status()).toBe(200);
    expect(await source.text()).toContain("工程样机已于六月完成验证");

    expect((await page.locator("strong").filter({ hasText: fileName }).boundingBox())!.height).toBeLessThan(30);
    await page.screenshot({ path: "/tmp/vc-project-assistant-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("heading", { name: "项目专属 AI 工作助手", exact: true })).toBeVisible();
    await expect(page.locator("main#main-content")).toHaveCSS("padding-left", "0px");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: "/tmp/vc-project-assistant-mobile.png", fullPage: true });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.reload();
    await page.getByRole("tab", { name: "项目知识库", exact: true }).click();
    await page.getByRole("button", { name: "我的项目问答记录", exact: true }).click();
    await page.getByText(`${question} · 已完成`, { exact: true }).click();
    await expect(page.getByText(answer, { exact: true })).toBeVisible();
    const retained = await authorContext.request.get(`/api/v1/projects/${projectId}/assistant`);
    expect(retained.status()).toBe(200);
    const stored = (await retained.json()).data;
    expect(stored.runs).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain("isolated-ai-test-openai-project");
    const anotherProject = await authorContext.request.get("/api/v1/projects/project-yaoshi/assistant");
    expect(anotherProject.status()).toBe(200);
    expect((await anotherProject.json()).data.runs).toEqual([]);

    await login(await otherContext.newPage(), member);
    const privateHistory = await otherContext.request.get(`/api/v1/projects/${projectId}/assistant`);
    expect(privateHistory.status()).toBe(200);
    expect((await privateHistory.json()).data.runs).toEqual([]);
  } finally { await authorContext.close(); await otherContext.close(); }
});
