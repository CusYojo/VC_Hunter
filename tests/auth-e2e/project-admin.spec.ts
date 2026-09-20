import { appendFileSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { readAuthFixture } from "./fixtures";
import { login } from "./login";

const progress = (step: string) => appendFileSync("/tmp/vc-project-admin-steps.log", `${step}\n`, { mode: 0o600 });

test("administrator creates and edits a real project while ordinary members cannot change its content", async ({ browser }) => {
  writeFileSync("/tmp/vc-project-admin-steps.log", "start\n", { mode: 0o600 });
  const origin = "http://127.0.0.1:3107";
  const { admin, member } = readAuthFixture();
  const adminContext = await browser.newContext({ baseURL: origin });
  const memberContext = await browser.newContext({ baseURL: origin });
  try {
    const page = await adminContext.newPage(); await login(page, admin); page.setDefaultTimeout(10_000); progress("administrator logged in");
    await page.goto("/projects?view=manage");
    progress("open create dialog");
    await page.getByRole("button", { name: "新建项目", exact: true }).click();
    const form = page.getByRole("dialog", { name: "新建项目" });
    progress("fill create fields");
    await form.getByLabel("项目名称", { exact: true }).fill("E2E管理员创建项目");
    await form.getByLabel("公司全称（可选）", { exact: true }).fill("E2E管理员项目有限公司");
    await form.getByRole("combobox", { name: /^赛道/ }).selectOption("新材料");
    await form.getByRole("textbox", { name: /^项目简介/ }).fill("管理员录入：样机验证完成，准备可靠性测试。");
    progress("save new project");
    const [created] = await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/projects" && response.request().method() === "POST"), form.getByRole("button", { name: "保存项目", exact: true }).click()]);
    const createdBody = await created.json();
    if (created.status() !== 201) throw new Error(`Project create HTTP ${created.status()} code ${createdBody.error?.code ?? "unknown"}`);
    progress("create API confirmed");
    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+$/);
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    await expect(page.getByRole("heading", { name: "E2E管理员创建项目", exact: true })).toBeVisible();
    progress("open edit dialog");
    await page.getByRole("button", { name: "编辑项目内容", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "编辑项目内容" });
    await edit.getByLabel("项目名称", { exact: true }).fill("E2E已更新项目内容");
    await edit.getByRole("textbox", { name: /^项目简介/ }).fill("管理员复核：可靠性测试进行中。");
    progress("save project changes");
    const [updated] = await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/projects/${id}` && response.request().method() === "PATCH"), edit.getByRole("button", { name: "保存项目", exact: true }).click()]);
    const updatedBody = await updated.json();
    if (updated.status() !== 200) throw new Error(`Project update HTTP ${updated.status()} code ${updatedBody.error?.code ?? "unknown"}`);
    progress("update API confirmed");
    await expect(page.getByRole("heading", { name: "E2E已更新项目内容", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator("header").getByText("管理员复核：可靠性测试进行中。", { exact: true })).toBeVisible();
    progress("reload content verified");
    const snapshot = (await (await adminContext.request.get(`/api/v1/projects/${id}`)).json()).data;
    expect(snapshot.version).toBe(2);
    expect(snapshot.executiveSummary).toBe("管理员复核：可靠性测试进行中。");
    const ordinaryPage = await memberContext.newPage(); await login(ordinaryPage, member); ordinaryPage.setDefaultTimeout(10_000); progress("member logged in");
    await ordinaryPage.goto(`/projects/${id}`);
    await expect(ordinaryPage.getByRole("button", { name: "编辑项目内容", exact: true })).toHaveCount(0);
    const headers = { origin, "idempotency-key": "ordinary-user-mutation" };
    expect((await memberContext.request.post("/api/v1/projects", { headers, data: { name: "不允许新建", track: "AI" } })).status()).toBe(403);
    expect((await memberContext.request.patch(`/api/v1/projects/${id}`, { headers, data: { expectedVersion: 2, name: "不允许修改" } })).status()).toBe(403);
    expect((await (await adminContext.request.get(`/api/v1/projects/${id}`)).json()).data.name).toBe("E2E已更新项目内容");
  } finally { await adminContext.close(); await memberContext.close(); }
});
