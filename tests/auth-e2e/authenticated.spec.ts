import { test, expect } from "@playwright/test";
import { readAuthFixture } from "./fixtures";
import { login } from "./login";


test("project files open, download and retain cross-account annotations and review", async ({ browser }) => {
  const { admin, member } = readAuthFixture();
  const authorContext = await browser.newContext({ baseURL: "http://127.0.0.1:3107" });
  const reviewerContext = await browser.newContext({ baseURL: "http://127.0.0.1:3107" });
  try {
    const author = await authorContext.newPage();
    await login(author, admin);
    await author.goto("/projects/project-qiongxin");
    await author.getByRole("tab", { name: "资料与审批" }).click();
    await author.getByRole("button", { name: "上传资料", exact: true }).click();
    await author.getByLabel("项目资料", { exact: true }).setInputFiles({ name: "项目审阅.txt", mimeType: "text/plain", buffer: Buffer.from("项目资料正文：请核验联系人。") });
    await author.getByRole("button", { name: "确认", exact: true }).click();
    await expect(author.getByRole("button", { name: "审核 / 批注 项目审阅.txt", exact: true })).toBeVisible();
    const downloadUrl = await author.getByRole("link", { name: "下载 项目审阅.txt", exact: true }).getAttribute("href");
    await author.getByRole("button", { name: "在线打开 项目审阅.txt", exact: true }).click();
    await expect(author.getByText("项目资料正文：请核验联系人。", { exact: true })).toBeVisible();
    await author.getByRole("button", { name: "展开审核 / 批注", exact: true }).click();
    await author.getByLabel("批注 / 审核意见", { exact: true }).fill("请确认联系人职位。");
    await author.getByRole("button", { name: "发表批注", exact: true }).click();
    await expect(author.getByText("请确认联系人职位。", { exact: true })).toBeVisible();

    const reviewer = await reviewerContext.newPage();
    await login(reviewer, member);
    await reviewer.goto("/projects/project-qiongxin");
    await reviewer.getByRole("tab", { name: "资料与审批" }).click();
    await reviewer.getByRole("button", { name: "审核 / 批注 项目审阅.txt", exact: true }).click();
    const thread = reviewer.getByRole("article", { name: "批注：请确认联系人职位。", exact: true });
    await expect(thread.getByText(admin.name, { exact: true })).toBeVisible();
    await thread.getByRole("button", { name: "回复批注：请确认联系人职位。", exact: true }).click();
    await reviewer.getByLabel("回复内容", { exact: true }).fill("已确认，职位为投资总监。");
    await reviewer.getByRole("button", { name: "发送回复", exact: true }).click();
    await expect(thread.getByText("已确认，职位为投资总监。", { exact: true })).toBeVisible();
    await reviewer.getByRole("button", { name: "标记通过", exact: true }).click();
    await expect(reviewer.getByText("资料已通过", { exact: true })).toBeVisible();
    await reviewer.getByRole("button", { name: "关闭资料面板", exact: true }).click();
    await reviewer.reload();
    await reviewer.getByRole("tab", { name: "资料与审批" }).click();
    await expect(reviewer.getByText("审核：已通过", { exact: true })).toBeVisible();
    const original = await reviewerContext.request.get(downloadUrl!);
    expect(original.status()).toBe(200);
    expect(original.headers()["content-disposition"]).toContain("attachment");
    expect(await original.text()).toBe("项目资料正文：请核验联系人。");
    await author.getByRole("button", { name: "刷新批注", exact: true }).click();
    await expect(author.getByText("已确认，职位为投资总监。", { exact: true })).toBeVisible();
    await expect(author.getByText("资料已通过", { exact: true })).toBeVisible();
    await author.screenshot({ path: "/tmp/vc-project-document-review-desktop.png" });
    // Verify the same panel at a narrow viewport and ensure document controls remain reachable.
    await author.setViewportSize({ width: 390, height: 844 });
    await expect(author.getByRole("button", { name: "关闭资料面板", exact: true })).toBeVisible();
    await author.screenshot({ path: "/tmp/vc-project-document-review-mobile.png" });
    const panel = author.getByRole("dialog", { name: "项目审阅.txt", exact: true });
    const bounds = await panel.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await author.getByRole("button", { name: "关闭资料面板", exact: true }).click();
    await author.setViewportSize({ width: 1280, height: 900 });
    for (const name of ["approval-preview.pdf", "approval-preview.docx"]) {
      await author.getByRole("button", { name: "上传资料", exact: true }).click();
      await author.getByLabel("项目资料", { exact: true }).setInputFiles(`tests/fixtures/${name}`);
      await author.getByRole("button", { name: "确认", exact: true }).click();
      await author.getByRole("button", { name: `在线打开 ${name}`, exact: true }).click();
      if (name.endsWith(".pdf")) {
        const pdfFrame = author.locator('iframe[title="approval-preview.pdf 预览"]');
        await expect(pdfFrame).toHaveAttribute("src", /^blob:/);
        await expect.poll(async () => (await pdfFrame.boundingBox())?.height ?? 0).toBeGreaterThan(850);
        const expandedWidth = (await pdfFrame.boundingBox())!.width;
        await author.getByRole("button", { name: "收起文件侧栏", exact: true }).click();
        await expect.poll(async () => (await pdfFrame.boundingBox())?.width ?? 0).toBeGreaterThan(expandedWidth + 200);
        await expect(author.getByRole("link", { name: "下载原文件", exact: true })).toHaveCount(0);
        await author.screenshot({ path: "/tmp/vc-file-viewer-pdf-desktop.png" });
        await author.getByRole("button", { name: "关闭资料面板", exact: true }).click();
        await author.setViewportSize({ width: 390, height: 844 });
        await author.getByRole("button", { name: `在线打开 ${name}`, exact: true }).click();
        await expect(author.getByRole("button", { name: "展开文件侧栏", exact: true })).toHaveAttribute("aria-expanded", "false");
        await expect.poll(async () => (await pdfFrame.boundingBox())?.height ?? 0).toBeGreaterThan(800);
        await expect.poll(() => author.getByRole("dialog", { name, exact: true }).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        await author.getByRole("button", { name: "展开文件侧栏", exact: true }).click();
        await expect(author.getByRole("link", { name: "下载原文件", exact: true })).toBeVisible();
        await author.getByRole("button", { name: "收起文件侧栏", exact: true }).click();
        await author.screenshot({ path: "/tmp/vc-file-viewer-pdf-mobile.png" });
      } else {
        await expect(author.getByText("Word 审批正文：资料核验完成。", { exact: true })).toBeVisible();
      }
      await author.getByRole("button", { name: "关闭资料面板", exact: true }).click();
      await author.setViewportSize({ width: 1280, height: 900 });
    }
  } finally { await authorContext.close(); await reviewerContext.close(); }
});

test("anonymous visitors cannot read pages or business APIs", async ({ page, request }) => {
  expect((await request.get("/api/v1/projects")).status()).toBe(401);
  expect((await request.get("/api/v1/investors")).status()).toBe(401);
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByLabel("账号")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "演示角色" })).toHaveCount(0);
});

test("admin signs in with a real username/password, visits projects and institutions, then signs out", async ({ page }) => {
  const { admin } = readAuthFixture();
  await login(page, admin);
  await expect(page.getByRole("heading", { name: "今日工作台" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "演示角色" })).toHaveCount(0);
  expect((await page.request.get("/api/v1/projects")).status()).toBe(200);
  expect((await page.request.get("/api/v1/investors")).status()).toBe(200);
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: /项目管理|项目中心/ }).first()).toBeVisible();
  await page.goto("/investors");
  await expect(page.getByRole("heading", { name: /机构|资源中心|行业追踪/ }).first()).toBeVisible();
  await page.getByRole("button", { name: /^退出(?:登录)?$/ }).click();
  await expect(page).toHaveURL(/\/login/);
  expect((await page.request.get("/api/v1/projects")).status()).toBe(401);
  await page.goBack();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: /项目管理|项目中心/ })).toHaveCount(0);
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByLabel("账号")).toBeVisible();
});

test("a second member receives a persistent task and cannot change another member's response", async ({ browser }) => {
  const { admin, member } = readAuthFixture();
  const adminContext = await browser.newContext({ baseURL: "http://127.0.0.1:3107" });
  const memberContext = await browser.newContext({ baseURL: "http://127.0.0.1:3107" });
  try {
    await login(await adminContext.newPage(), admin);
    const created = await adminContext.request.post("/api/v1/activity", { headers: { origin: "http://127.0.0.1:3107", "idempotency-key": "auth-e2e-task" },
      data: { kind: "task", title: "E2E共同项目复核", description: "临时数据库中的权限验证事项", participantIds: [member.teamUserId], dueAt: new Date().toISOString(), location: "", projectId: null } });
    expect(created.status()).toBe(200);
    const createdData = await created.json();
    const item = createdData.data;
    const memberPage = await memberContext.newPage();
    await login(memberPage, member);
    const visible = await memberContext.request.get("/api/v1/activity");
    expect(visible.status()).toBe(200);
    expect((await visible.json()).data.some((row: { id: string }) => row.id === item.id)).toBe(true);
    const accepted = await memberContext.request.patch(`/api/v1/activity/${item.id}`, { headers: { origin: "http://127.0.0.1:3107" }, data: { action: "accepted", expectedVersion: item.version, note: "已收到，正在复核" } });
    expect(accepted.status()).toBe(200);
    await memberPage.reload();
    const persisted = (await (await memberContext.request.get("/api/v1/activity")).json()).data.find((row: { id: string }) => row.id === item.id);
    expect(persisted.responses.some((row: { memberId: string; action: string }) => row.memberId === member.teamUserId && row.action === "accepted")).toBe(true);
    const spoof = await adminContext.request.patch(`/api/v1/activity/${item.id}`, { headers: { origin: "http://127.0.0.1:3107", "x-user-id": member.teamUserId }, data: { action: "declined", expectedVersion: persisted.version, note: "spoof" } });
    expect(spoof.status()).toBe(400);
  } finally { await adminContext.close(); await memberContext.close(); }
});

test("approval documents persist across accounts and can be previewed before approving", async ({ browser }) => {
  const { admin, member } = readAuthFixture();
  const authorContext = await browser.newContext({ baseURL: "http://127.0.0.1:3107" });
  const reviewerContext = await browser.newContext({ baseURL: "http://127.0.0.1:3107" });
  try {
    const author = await authorContext.newPage();
    await login(author, admin);
    await author.goto("/approvals");
    await author.getByRole("button", { name: "新建事项" }).click();
    await author.getByLabel("事项标题").fill("E2E审批附件核验");
    await author.getByLabel("截止或开始时间").fill("2026-09-05T10:00");
    await author.getByLabel(member.name, { exact: true }).check();
    await author.getByRole("button", { name: "保存到工作空间" }).click();
    const authorCard = author.getByRole("article").filter({ has: author.getByRole("button", { name: "事项概览：E2E审批附件核验", exact: true }) });
    await authorCard.getByRole("button", { name: "事项概览：E2E审批附件核验", exact: true }).click();
    await authorCard.getByLabel("上传审批资料").setInputFiles({ name: "核验说明.txt", mimeType: "text/plain", buffer: Buffer.from("审批附件正文：已核对项目资料。") });
    const [uploadResponse] = await Promise.all([
      author.waitForResponse((response) => response.url().includes("/documents") && response.request().method() === "POST"),
      authorCard.getByRole("button", { name: "上传资料", exact: true }).click(),
    ]);
    expect(uploadResponse.status()).toBe(201);
    await expect(authorCard.getByRole("button", { name: "预览 核验说明.txt" })).toBeVisible();
    for (const name of ["approval-preview.pdf", "approval-preview.docx"]) {
      await authorCard.getByLabel("上传审批资料").setInputFiles(`tests/fixtures/${name}`);
      const [response] = await Promise.all([
        author.waitForResponse((response) => response.url().includes("/documents") && response.request().method() === "POST"),
        authorCard.getByRole("button", { name: "上传资料", exact: true }).click(),
      ]);
      expect(response.status()).toBe(201);
      await expect(authorCard.getByRole("button", { name: `预览 ${name}` })).toBeVisible();
    }
    await author.reload();
    await authorCard.getByRole("button", { name: "事项概览：E2E审批附件核验", exact: true }).click();
    await expect(authorCard.getByRole("button", { name: "预览 核验说明.txt" })).toBeVisible();

    const reviewer = await reviewerContext.newPage();
    await login(reviewer, member);
    await reviewer.goto("/approvals");
    const reviewerCard = reviewer.getByRole("article").filter({ has: reviewer.getByRole("button", { name: "事项概览：E2E审批附件核验", exact: true }) });
    await reviewerCard.getByRole("button", { name: "事项概览：E2E审批附件核验", exact: true }).click();
    await expect(reviewerCard.getByLabel("上传审批资料")).toHaveCount(0);
    await reviewerCard.getByRole("button", { name: "预览 核验说明.txt" }).click();
    await expect(reviewer.getByRole("dialog", { name: "核验说明.txt", exact: true }).getByText("审批附件正文：已核对项目资料。", { exact: true })).toBeVisible();
    await reviewer.getByRole("button", { name: "关闭预览", exact: true }).click();
    await reviewerCard.getByRole("button", { name: "预览 approval-preview.pdf" }).click();
    const pdf = reviewer.getByRole("dialog", { name: "approval-preview.pdf", exact: true }).locator('iframe[title="PDF 预览：approval-preview.pdf"]');
    await expect(pdf).toBeVisible();
    await expect(pdf).toHaveAttribute("src", /^blob:/);
    await reviewer.getByRole("button", { name: "关闭预览", exact: true }).click();
    await reviewerCard.getByRole("button", { name: "预览 approval-preview.docx" }).click();
    await expect(reviewer.getByRole("dialog", { name: "approval-preview.docx", exact: true }).getByText("Word 审批正文：资料核验完成。", { exact: true })).toBeVisible();
    await reviewer.getByRole("button", { name: "关闭预览", exact: true }).click();
    const download = reviewerCard.getByRole("link", { name: "下载 核验说明.txt" });
    const original = await reviewerContext.request.get((await download.getAttribute("href"))!);
    expect(original.status()).toBe(200);
    expect(original.headers()["content-disposition"]).toContain("attachment");
    expect(await original.text()).toBe("审批附件正文：已核对项目资料。");
    await reviewerCard.getByLabel("处理意见（调整 / 退回时必填）").fill("在线核验完成，同意。");
    await reviewerCard.getByRole("button", { name: "批准", exact: true }).click();
    await expect(reviewerCard.getByRole("button", { name: "批准", exact: true })).toHaveCount(0);
    await author.getByRole("button", { name: "刷新事项" }).click();
    await expect(authorCard.getByLabel("上传审批资料")).toHaveCount(0);
    await expect(authorCard.getByText(/在线核验完成，同意。/).first()).toBeVisible();
    await expect(authorCard.getByRole("button", { name: "预览 核验说明.txt" })).toBeVisible();
  } finally { await authorContext.close(); await reviewerContext.close(); }
});
