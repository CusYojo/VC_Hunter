import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { readAuthFixture } from "./fixtures";
import { login } from "./login";

const origin = "http://127.0.0.1:3107";
const projectId = "project-qiongxin";

test("multiple project responsibles persist and intake can combine distribution with joining", async ({ browser }) => {
  const { admin, member } = readAuthFixture();
  const context = await browser.newContext({ baseURL: origin });
  try {
    const page = await context.newPage();
    await login(page, admin);
    await page.goto(`/projects/${projectId}`);
    await page.getByRole("button", { name: "分配负责人", exact: true }).click();
    const assignment = page.getByRole("dialog", { name: "分配项目负责人", exact: true });
    await assignment.getByRole("checkbox", { name: new RegExp(`^${admin.name} ·`) }).check();
    await assignment.getByRole("checkbox", { name: new RegExp(`^${member.name} ·`) }).check();
    const [assigned] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith(`/projects/${projectId}/assignment`) && response.request().method() === "PATCH"),
      assignment.getByRole("button", { name: "确认", exact: true }).click(),
    ]);
    expect(assigned.status()).toBe(200);
    expect((await assigned.json()).data.owners).toEqual([admin.name, member.name]);
    const stored = (await (await context.request.get(`/api/v1/projects/${projectId}`)).json()).data;
    expect(stored.owners).toEqual([admin.name, member.name]);
    await page.reload();
    await expect(page.getByText(`负责人：${admin.name}、${member.name}`, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "分配负责人", exact: true }).click();
    await expect(assignment.getByRole("checkbox", { name: new RegExp(`^${member.name} ·`) })).toBeChecked();
    await assignment.getByRole("checkbox", { name: new RegExp(`^${member.name} ·`) }).uncheck();
    const [single] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith(`/projects/${projectId}/assignment`) && response.request().method() === "PATCH"),
      assignment.getByRole("button", { name: "确认", exact: true }).click(),
    ]);
    expect(single.status()).toBe(200);
    expect((await single.json()).data.owners).toEqual([admin.name]);
    await page.reload();
    await expect(page.getByText(`负责人：${admin.name}`, { exact: true })).toBeVisible();

    const companyName = `E2E多人负责人项目-${randomUUID().slice(0, 8)}`;
    const created = await context.request.post("/api/v1/candidates", {
      headers: { origin, "idempotency-key": randomUUID() },
      multipart: {
        data: JSON.stringify({ companyName, track: "半导体", summary: "仅在隔离测试库验证多人分发与我感兴趣的组合入库。" }),
        file: { name: "多人入库验证.txt", mimeType: "text/plain", buffer: Buffer.from("隔离测试项目原始资料。") },
      },
    });
    expect(created.status()).toBe(201);
    const candidate = (await created.json()).data;
    await page.goto("/discover");
    const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name: companyName, exact: true }) });
    await card.getByRole("button", { name: "入库", exact: true }).click();
    const intake = page.getByRole("dialog", { name: `入库 · ${companyName}`, exact: true });
    await intake.getByRole("checkbox", { name: "分发给同事", exact: true }).check();
    await intake.getByRole("checkbox", { name: member.name, exact: true }).check();
    await intake.getByRole("checkbox", { name: "我感兴趣，加入项目", exact: true }).check();
    const [admitted] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith(`/candidates/${candidate.id}/review`) && response.request().method() === "PATCH"),
      intake.getByRole("button", { name: "确认入库", exact: true }).click(),
    ]);
    expect(admitted.status()).toBe(200);
    const project = (await admitted.json()).data;
    await expect(card.getByText("已入库", { exact: true })).toBeVisible();
    expect((await (await context.request.get(`/api/v1/projects/${project.projectId}`)).json()).data.owners).toEqual([member.name, admin.name]);
    await page.reload();
    await expect(card.getByRole("heading", { name: companyName, exact: true })).toBeVisible();
    await expect(card.getByText("已入库", { exact: true })).toBeVisible();
    await card.getByRole("link", { name: "打开项目", exact: true }).click();
    await expect(page.getByText(`负责人：${member.name}、${admin.name}`, { exact: true })).toBeVisible();
    await page.screenshot({ path: "/tmp/vc-project-responsibles.png", fullPage: true });
  } finally { await context.close(); }
});
