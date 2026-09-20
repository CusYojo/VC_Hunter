import { test, expect } from "@playwright/test";
import { readAuthFixture } from "./fixtures";
import { login } from "./login";

test("real business records cover every fund, finance and relationship view and survive reload", async ({ page }) => {
  test.setTimeout(180000);
  const { admin } = readAuthFixture();
  await login(page, admin);
  const projectResponse = await page.request.get("/api/v1/projects/project-qiongxin");
  expect(projectResponse.status()).toBe(200);
  const project = (await projectResponse.json()).data;
  await page.getByRole("button", { name: "打开全局搜索", exact: true }).click();
  await page.getByRole("combobox", { name: "搜索项目、机构、人物或功能" }).fill(project.name);
  await page.getByRole("option").filter({ hasText: project.name }).first().click();
  await expect(page).toHaveURL(/\/projects\/project-qiongxin$/);
  const scenarios = [
    { url: "/funds", kind: "基金", name: "E2E真实基金", fields: { "认缴金额（元）": "1000000", "实缴金额（元）": "10000", "净资产 NAV（元）": "10000", "成立年份": "2026" } },
    { url: "/funds?view=lp", kind: "LP 跟进", name: "E2E LP跟进", fields: { "联系人 / 联系方式": "公开联系渠道", "承诺金额（元）": "10000", "下次跟进": "2026-10-01" } },
    { url: "/funds?view=portfolio", kind: "投资组合", name: "E2E投资记录", fields: { "投资成本（元）": "1000", "当前估值（元）": "1000" } },
    { url: "/finance", kind: "费用", name: "E2E费用记录", fields: { "费用金额（元）": "120.50", "发生日期": "2026-09-04" } },
    { url: "/finance?view=invoices", kind: "发票", name: "E2E发票记录", fields: { "价税合计（元）": "120.50", "发票号码": "E2E-INV-1", "开票方": "测试公司", "开票日期": "2026-09-04" } },
    { url: "/finance?view=payments", kind: "付款记录", name: "E2E付款台账", fields: { "付款金额（元）": "120.50", "收款方": "测试公司", "计划付款日": "2026-09-04", "实际付款日": "2026-09-04", "银行回单 / 付款凭证编号": "E2E-REF-1" } },
    { url: "/finance?view=budget", kind: "预算", name: "E2E年度预算", fields: { "预算金额（元）": "10000", "预算期间（例如 2026 或 2026-Q3）": "2026" } },
    { url: "/finance?view=contracts", kind: "合同风险", name: "E2E合同审查", fields: { "合同对方": "测试公司", "风险事项 / 审查意见": "需确认交付验收条款" } },
    { url: "/resources", kind: "联系人", name: "E2E联系人", fields: { "联系方式": "public@example.test", "所属机构": "测试公司" } },
    { url: "/resources?view=experts", kind: "专家", name: "E2E专家", fields: { "专业领域": "半导体工艺", "联系方式": "expert@example.test" } },
  ];
  for (const scenario of scenarios) {
    await page.goto(scenario.url);
    await page.getByRole("button", { name: `新建${scenario.kind}`, exact: true }).click();
    await page.getByLabel("名称", { exact: true }).fill(scenario.name);
    for (const [label, value] of Object.entries(scenario.fields)) await page.getByLabel(label, { exact: true }).fill(value);
    if (scenario.kind === "投资组合") {
      await page.getByRole("combobox", { name: /^关联基金/ }).selectOption({ label: "E2E真实基金" });
      await page.getByRole("combobox", { name: /^关联项目/ }).selectOption("project-qiongxin");
    }
    if (scenario.kind === "付款记录") await page.getByRole("combobox", { name: /^状态/ }).selectOption("paid");
    await page.getByRole("button", { name: "保存记录", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: scenario.name, exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: scenario.name, exact: true })).toBeVisible();
  }
  await page.goto("/finance");
  await page.getByRole("button", { name: "编辑 E2E费用记录", exact: true }).click();
  await page.getByLabel("名称", { exact: true }).fill("E2E费用记录已核对");
  await page.getByRole("button", { name: "保存记录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "E2E费用记录已核对", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "归档 E2E费用记录已核对", exact: true }).click();
  await expect(page.getByRole("heading", { name: "E2E费用记录已核对", exact: true })).toHaveCount(0);
  await page.getByLabel("包含已归档", { exact: true }).check();
  await page.getByRole("button", { name: "恢复 E2E费用记录已核对", exact: true }).click();
  await expect(page.getByRole("button", { name: "归档 E2E费用记录已核对", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "新建费用", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect.poll(async () => { const box = await dialog.boundingBox(); return box ? box.x + box.width : Infinity; }).toBeLessThanOrEqual(391);
  expect((await dialog.boundingBox())!.x).toBeGreaterThanOrEqual(0);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/vc-business-mobile-e2e.png" });
});
