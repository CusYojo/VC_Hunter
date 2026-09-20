import { expect, test } from "@playwright/test";

test("investment manager discovers a project and advances it to DD", async ({ page }) => {
  await page.goto("/discover");
  await page.getByLabel("搜索主题").fill("国内头部机构 半导体 新投资");
  await page.getByRole("button", { name: "让 AI 搜索" }).click();
  await expect(page.getByText("搜索任务已入队")).toBeVisible();

  await page.goto("/projects/project-qiongxin");
  await page.getByRole("button", { name: "推进阶段" }).click();
  const dialog = page.getByRole("dialog", { name: "推进项目阶段" });
  await dialog.getByRole("combobox", { name: "推进至" }).selectOption("dd");
  await dialog.getByRole("button", { name: "确认" }).click();
  await expect(page.getByText("项目阶段已更新", { exact: true })).toBeVisible();
});

test("partner sees stalled work and approves an IC request", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "演示角色" }).selectOption("partner");
  await expect(page.getByRole("heading", { name: "今日工作台" })).toBeVisible();
  await expect(page.getByText("Partner / 合伙人视图")).toBeVisible();
  await expect(page.getByRole("heading", { name: "我负责的项目" })).toBeVisible();

  await page.goto("/approvals");
  await page.getByRole("button", { name: "查看 灵巧智能 Pre-A 轮 IC 决策" }).click();
  await page.getByRole("button", { name: "批准申请" }).click();
  await expect(page.getByRole("dialog", { name: "灵巧智能 Pre-A 轮 IC 决策" }).getByText("已批准", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("link", { name: "已完成" }).click();
  await expect(page.getByText("灵巧智能 Pre-A 轮 IC 决策")).toBeVisible();
});

test("dashboard task response persists after refresh", async ({ page }) => {
  await page.goto("/more");
  await page.getByRole("button", { name: "重置演示数据" }).click();
  await page.goto("/");

  await page.getByRole("button", { name: "接受待办 补齐具身机器人客户访谈" }).click();
  await expect(page.getByRole("status")).toContainText("已接受待办");
  await page.reload();
  await expect(page.getByText("已接受", { exact: true }).first()).toBeVisible();
});

test("researcher opens research, evidence, and open questions", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "演示角色" }).selectOption("researcher");
  await page.goto("/projects/project-qiongxin?view=research");
  await expect(page.getByRole("heading", { name: "项目研究" })).toBeVisible();
  await page.getByRole("tab", { name: "项目总览" }).click();
  await expect(page.getByRole("heading", { name: "开放问题" }).first()).toBeVisible();

  await page.getByRole("tab", { name: "资料与审批" }).click();
  await page.getByTestId("assertion-technology_milestone").getByRole("button", { name: "证据 A" }).click();
  const evidenceDialog = page.getByRole("dialog", { name: "技术里程碑" });
  await expect(evidenceDialog.getByText("字段级证据")).toBeVisible();
  await page.getByRole("button", { name: "关闭证据面板" }).click();
});

test("legal reviews a risky contract and returns it for more material", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "演示角色" }).selectOption("legal_compliance");
  await page.goto("/finance?view=contracts");
  await page.getByRole("button", { name: "退回补充 玄芯微电子增资协议" }).click();
  await expect(page.getByRole("status")).toContainText("合同已退回补充材料");
  await page.reload();
  await expect(page.getByText("已退回")).toBeVisible();
});

test("finance completes an approved project payment", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "演示角色" }).selectOption("finance");
  await page.goto("/finance?view=payments");
  await page.getByRole("button", { name: "完成付款 灵巧智能首期投资款" }).click();
  await expect(page.getByRole("status")).toContainText("付款已完成并保存到演示账本");
  await page.reload();
  await expect(page.getByText("已支付")).toBeVisible();
  await expect(page.getByText("硬科技成长二期基金")).toBeVisible();
});

test("administrator toggles a conditional approval workflow", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "演示角色" }).selectOption("super_admin");
  await page.goto("/admin?view=workflows");
  await expect(page.getByText("分支预览").first()).toBeVisible();
  await page.getByRole("button", { name: "停用 投资项目分级审批" }).click();
  await expect(page.getByRole("status")).toContainText("工作流已停用");
  await page.reload();
  await expect(page.getByRole("button", { name: "启用 投资项目分级审批" })).toBeVisible();
});

test("demo state persists across refresh and reset restores fixtures", async ({ page }) => {
  await page.goto("/work");
  await page.getByRole("button", { name: "完成 补齐具身机器人客户访谈" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "完成 补齐具身机器人客户访谈" })).toHaveCount(0);

  await page.goto("/more");
  await page.getByRole("button", { name: "重置演示数据" }).click();
  await expect(page.getByRole("status")).toContainText("演示数据已恢复");
  await page.goto("/work");
  await expect(page.getByRole("button", { name: "完成 补齐具身机器人客户访谈" })).toBeVisible();
});

test("real project actions keep judgments and local documents auditable", async ({ page }) => {
  await page.goto("/projects/project-qiongxin");
  await page.getByRole("button", { name: "记录判断" }).click();
  const judgmentDialog = page.getByRole("dialog", { name: "记录本期投资判断" });
  await judgmentDialog.getByRole("combobox", { name: "判断倾向" }).selectOption("cautious");
  await judgmentDialog.getByRole("textbox", { name: "本期投资判断" }).fill("客户送测已经开始，但量产良率与复购节奏仍需连续验证。");
  await judgmentDialog.getByRole("button", { name: "确认" }).click();
  await expect(page.getByText("投资判断已写入时间线", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "上传资料" }).click();
  const uploadDialog = page.getByRole("dialog", { name: "上传项目资料" });
  await uploadDialog.getByLabel("项目资料").setInputFiles({ name: "weekly-update.md", mimeType: "text/markdown", buffer: Buffer.from("2026-09-02 客户送测进行中。风险：量产良率仍待验证。") });
  await uploadDialog.getByRole("button", { name: "确认" }).click();
  await expect(page.getByText("资料已上传，等待 Agent 分析", { exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole("tab", { name: "项目总览" }).click();
  await expect(page.getByText("客户送测已经开始，但量产良率与复购节奏仍需连续验证。")).toBeVisible();
  await page.getByRole("tab", { name: "资料与审批" }).click();
  await expect(page.getByRole("tabpanel", { name: "资料与审批" }).getByText("weekly-update.md", { exact: true })).toBeVisible();
});

test("legacy links redirect into the consolidated business centers", async ({ page }) => {
  const redirects = [
    ["/discover", "/projects?view=discovery"],
    ["/review", "/projects?view=review"],
    ["/knowledge", "/research?view=knowledge"],
    ["/talent", "/resources?view=people"],
    ["/investors", "/resources?view=institutions"],
    ["/admin/sources", "/admin?view=sources"],
  ] as const;
  for (const [legacy, destination] of redirects) {
    await page.goto(legacy);
    await expect(page).toHaveURL(new RegExp(`${destination.replace("?", "\\?")}$`));
  }
});
