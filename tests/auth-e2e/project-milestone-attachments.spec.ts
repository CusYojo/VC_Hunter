import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { readAuthFixture } from "./fixtures";
import { login } from "./login";

const origin = "http://127.0.0.1:3107";
const projectId = "project-qiongxin";

test("uploads a local file from a project milestone and keeps the protected original after reload", async ({ page }) => {
  await login(page, readAuthFixture().admin);
  const title = `节点文件验收-${randomUUID().slice(0, 8)}`;
  const fileName = `${title}.txt`;
  const content = "项目推进节点原始资料：刷新后仍须完整下载。";
  const created = await page.request.post(`/api/v1/projects/${projectId}/milestones`, {
    headers: { origin, "idempotency-key": randomUUID() }, data: { stage: "dd", title },
  });
  expect(created.status()).toBe(201);
  const createdMilestone = (await created.json()).data as { id: string };

  await page.goto(`/projects/${projectId}`);
  await page.getByRole("tab", { name: "项目流程", exact: true }).click();
  const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await card.getByRole("button", { name: "更新节点", exact: true }).click();
  await card.getByRole("button", { name: "添加资料", exact: true }).click();
  await card.getByLabel("上传本地文件", { exact: true }).setInputFiles({ name: fileName, mimeType: "text/plain", buffer: Buffer.from(content) });
  const [upload] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith(`/projects/${projectId}/milestones/${createdMilestone.id}/attachments`) && response.request().method() === "POST"),
    card.getByRole("button", { name: "上传并附加", exact: true }).click(),
  ]);
  expect(upload.status()).toBe(201);
  const download = card.getByRole("link", { name: `下载推进节点资料：${fileName}`, exact: true });
  await expect(download).toBeVisible();
  const href = await download.getAttribute("href");
  const original = await page.request.get(href!);
  expect(original.status()).toBe(200);
  expect(await original.text()).toBe(content);

  await page.reload();
  await page.getByRole("tab", { name: "项目流程", exact: true }).click();
  await expect(page.getByRole("link", { name: `下载推进节点资料：${fileName}`, exact: true })).toBeVisible();
});
