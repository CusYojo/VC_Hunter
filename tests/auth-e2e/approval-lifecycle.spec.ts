import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { readAuthFixture } from "./fixtures";
import { login } from "./login";

const origin = "http://127.0.0.1:3107";
const card = (page: Page, title: string) => page.getByRole("article").filter({ has: page.getByRole("button", { name: `事项概览：${title}`, exact: true }) });
async function create(api: APIRequestContext, title: string, recipient: string) {
  const result = await api.post("/api/v1/activity", { headers: { origin, "idempotency-key": randomUUID() }, data: { kind: "approval", title, participantIds: [recipient], dueAt: null } });
  expect(result.ok()).toBe(true);return (await result.json()).data;
}
async function lifecycle(api: APIRequestContext, id: string, action: string, expectedVersion: number) {
  return api.post(`/api/v1/activity/${id}/lifecycle`, { headers: { origin }, data: { action, expectedVersion } });
}

test("applicants withdraw requests and complete approved reimbursements before next-day archival", async ({ browser }) => {
  const { admin, member } = readAuthFixture();
  const applicant = await browser.newContext({ baseURL: origin }), approver = await browser.newContext({ baseURL: origin });
  applicant.setDefaultTimeout(15_000);approver.setDefaultTimeout(15_000);
  try {
    const author = await applicant.newPage(), reviewer = await approver.newPage();
    await login(author, member);await login(reviewer, admin);
    await author.goto("/approvals");
    await author.getByRole("button", { name: "新建事项", exact: true }).click();
    await author.getByRole("combobox", { name: /^审批类型/ }).selectOption("reimbursement");
    await author.getByLabel("事项标题", { exact: true }).fill("差旅报销生命周期验收");
    await author.getByLabel("截止或开始时间", { exact: true }).fill("");
    await author.getByLabel(admin.name, { exact: true }).check();
    await author.getByLabel("附上文件", { exact: true }).setInputFiles({ name: "报销凭证.txt", mimeType: "text/plain", buffer: Buffer.from("报销凭证原件需要保留") });
    const [made] = await Promise.all([author.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/activity"), author.getByRole("button", { name: "保存到工作空间", exact: true }).click()]);
    expect(made.ok()).toBe(true);const request = (await made.json()).data;
    expect(request).toMatchObject({ kind: "approval", approvalType: "reimbursement", status: "active" });
    const title = request.title;
    await card(author, title).getByRole("button", { name: `事项概览：${title}`, exact: true }).click();
    await expect(card(author, title).getByText("报销", { exact: true })).toBeVisible();
    await expect(card(author, title).getByRole("button", { name: "任务已完成", exact: true })).toHaveCount(0);
    expect((await lifecycle(applicant.request, request.id, "complete", request.version)).status()).toBe(400);
    expect((await lifecycle(approver.request, request.id, "withdraw", request.version)).status()).toBe(403);
    const withdrawn = await create(applicant.request, "申请方撤回验收", admin.teamUserId);
    await author.goto(`/approvals?activity=${withdrawn.id}`);
    await card(author, withdrawn.title).getByRole("button", { name: "撤回申请", exact: true }).click();
    await card(author, withdrawn.title).getByRole("button", { name: "确认撤回", exact: true }).click();
    await author.getByRole("button", { name: "已撤回", exact: true }).click();
    await expect(card(author, withdrawn.title)).toBeVisible();
    const stale = await approver.request.patch(`/api/v1/activity/${withdrawn.id}`, { headers: { origin }, data: { action: "approved", expectedVersion: withdrawn.version } });
    expect([400, 409]).toContain(stale.status());
    await reviewer.goto(`/approvals?activity=${withdrawn.id}`);
    await expect(card(reviewer, withdrawn.title)).toBeVisible();
    await expect(card(reviewer, withdrawn.title).getByRole("button", { name: "批准", exact: true })).toHaveCount(0);
    await reviewer.goto(`/approvals?activity=${request.id}`);
    const originalUrl = await card(reviewer, title).getByRole("link", { name: "下载 报销凭证.txt", exact: true }).getAttribute("href");
    await card(reviewer, title).getByRole("button", { name: "批准", exact: true }).click();
    const approved = (await (await applicant.request.get("/api/v1/activity")).json()).data.find((item: { id: string }) => item.id === request.id);
    expect((await lifecycle(approver.request, request.id, "complete", approved.version)).status()).toBe(403);
    expect((await lifecycle(applicant.request, request.id, "withdraw", approved.version)).status()).toBe(400);
    await create(applicant.request, "仍待处理的审批", admin.teamUserId);
    await author.goto(`/approvals?activity=${request.id}`);
    await card(author, title).getByRole("button", { name: "任务已完成", exact: true }).click();
    const completed = (await (await applicant.request.get("/api/v1/activity")).json()).data.find((item: { id: string }) => item.id === request.id);
    expect(completed).toMatchObject({ status: "completed", responses: [{ action: "approved" }] });
    expect(new Date(completed.archiveAt).getTime()).toBeGreaterThan(new Date(completed.completedAt).getTime());
    const summaries = await author.getByRole("button", { name: /^事项概览：/ }).allTextContents();
    expect(summaries.at(-1)).toContain(title);
    await expect(card(author, title).getByRole("button", { name: "编辑事项", exact: true })).toHaveCount(0);
    // Move only the isolated archival clock; the original completion timestamp stays intact.
    const { archiveDueApprovals } = await import("../../src/workbench/approval-lifecycle");
    const database = new DatabaseSync(join(process.env.VC_HUNTER_AUTH_E2E_DIRECTORY!, "business.db"));
    try {
      expect(archiveDueApprovals(database, new Date(new Date(completed.archiveAt).getTime() - 1))).toBe(0);
      expect(archiveDueApprovals(database, new Date(completed.archiveAt))).toBe(1);
      expect(archiveDueApprovals(database, new Date(completed.archiveAt))).toBe(0);
    } finally { database.close(); }
    await author.goto("/approvals");
    await expect(card(author, title)).toHaveCount(0);
    await author.getByRole("button", { name: "已归档", exact: true }).click();
    await expect(card(author, title)).toBeVisible();
    await card(author, title).getByRole("button", { name: `事项概览：${title}`, exact: true }).click();
    await expect(card(author, title).getByRole("button", { name: "编辑事项", exact: true })).toHaveCount(0);
    await expect(card(author, title).getByText(/已批准/).first()).toBeVisible();
    const original = await applicant.request.get(originalUrl!);expect(original.status()).toBe(200);expect(await original.text()).toBe("报销凭证原件需要保留");
    await author.screenshot({ path: "/tmp/vc-approval-archive-desktop.png" });
    await author.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => author.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await author.screenshot({ path: "/tmp/vc-approval-archive-mobile.png" });
  } finally { await applicant.close();await approver.close(); }
});
