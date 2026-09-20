import { appendFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { readAuthFixture } from "./fixtures";
import { login } from "./login";
const progress = (step: string) => appendFileSync("/tmp/vc-candidate-steps.log", `${step}\n`, { mode: 0o600 });
const origin = "http://127.0.0.1:3107";
test("discovery date filters, deferred candidate hiding and administrator order persist", async ({ browser }) => {
  writeFileSync("/tmp/vc-candidate-steps.log", "start\n", { mode: 0o600 });
  const { admin, member } = readAuthFixture();
  const adminContext = await browser.newContext({ baseURL: origin });
  const memberContext = await browser.newContext({ baseURL: origin });
  try {
    const page = await adminContext.newPage(); await login(page, admin); page.setDefaultTimeout(10_000); progress("admin logged in");
    const candidates: { id: string; companyName: string; version: number }[] = [];
    for (const name of ["排序验收甲", "排序验收乙", "排序验收丙"]) {
      const response = await adminContext.request.post("/api/v1/candidates", { headers: { origin, "idempotency-key": randomUUID() }, multipart: { data: JSON.stringify({ companyName: name, track: "半导体", summary: `${name}开发芯片验证设备，等待人工评估。`, investorNames: "", sourceText: "测试资料" }), file: { name: `${name}.txt`, mimeType: "text/plain", buffer: Buffer.from("隔离验收项目资料") } } });
      expect(response.status()).toBe(201); candidates.push((await response.json()).data);
    }
    progress("open discovery");
    await page.goto("/projects?view=discovery");
    await expect(page.getByRole("button", { name: "当天", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByLabel("筛选项目关键词", { exact: true }).fill("排序验收");
    const card = (name: string) => page.getByRole("article").filter({ has: page.getByRole("heading", { name, exact: true }) });
    progress("move candidate");
    const [reorder] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === "/api/v1/candidates/order" && r.request().method() === "PATCH"), card("排序验收甲").getByRole("button", { name: "上移 排序验收甲", exact: true }).click()]);
    expect(reorder.status()).toBe(200);
    await page.reload(); await page.getByLabel("筛选项目关键词", { exact: true }).fill("排序验收");
    progress("order reloaded");
    const beforeReject = await page.locator("article h3").allTextContents();
    expect(beforeReject.indexOf("排序验收甲")).toBeLessThan(beforeReject.indexOf("排序验收乙"));
    progress("reject candidate");
    await card("排序验收丙").getByRole("button", { name: "暂不跟进", exact: true }).click();
    await expect(card("排序验收丙")).toHaveCount(0);
    await expect(page.getByText("可在更多功能 → 全部项目中查找，原始资料和处理记录均已保留。", { exact: true })).toBeVisible();
    await card("排序验收乙").getByRole("button", { name: "编辑项目信息", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "编辑项目 · 排序验收乙", exact: true });
    await editor.getByLabel("项目名称", { exact: true }).fill("排序验收乙（已校订）");
    await editor.getByRole("textbox", { name: /^项目摘要/ }).fill("已核实芯片验证设备进展，继续保留上传的原始资料。");
    const [edited] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/candidates/${candidates[1].id}` && response.request().method() === "PATCH"),
      editor.getByRole("button", { name: "保存项目内容", exact: true }).click(),
    ]);
    expect(edited.status()).toBe(200);
    const editedCandidate = (await edited.json()).data;
    expect(editedCandidate.companyName).toBe("排序验收乙（已校订）");
    await expect(editor).toBeHidden();
    await page.reload(); await page.getByLabel("筛选项目关键词", { exact: true }).fill("排序验收");
    await expect(card("排序验收乙（已校订）")).toBeVisible();
    await expect(card("排序验收乙（已校订）").getByText("已核实芯片验证设备进展，继续保留上传的原始资料。", { exact: true })).toBeVisible();
    const original = await adminContext.request.get(`/api/v1/candidates/${candidates[1].id}/document?download=1`);
    expect(original.status()).toBe(200);
    expect((await original.body()).toString()).toBe("隔离验收项目资料");
    expect(decodeURIComponent(original.headers()["content-disposition"])).toContain("排序验收乙.txt");
    await expect(page.getByRole("link", { name: "全部项目", exact: true }).first()).toHaveAttribute("href", "/all-projects");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
    await page.getByLabel("按日期查看项目", { exact: true }).fill(today);
    await expect(page.getByRole("article")).toHaveCount(2);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.locator("#main-content").evaluate(element => getComputedStyle(element).paddingLeft)).toBe("0px");
    await page.screenshot({ path: "/tmp/vc-candidate-queue-mobile.png", fullPage: true, animations: "disabled" });
    await page.screenshot({ path: "/tmp/vc-candidate-queue-mobile-viewport.png", animations: "disabled" });
    const dimensions = await page.evaluate(() => ({
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      main: (() => { const box = document.querySelector("#main-content")!.getBoundingClientRect(); return { left: box.left, width: box.width }; })(),
      overflowing: [...document.querySelectorAll("body *")].map(element => {
        const rect = element.getBoundingClientRect();
        return { tag: element.tagName, className: String(element.className), left: rect.left, right: rect.right, width: rect.width };
      }).filter(item => item.right > innerWidth + 1).sort((a, b) => b.width - a.width).slice(0, 20),
    }));
    writeFileSync("/tmp/vc-candidate-overflow.json", JSON.stringify(dimensions, null, 2), { mode: 0o600 });
    expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewport);
    expect(dimensions.main.left).toBe(0);
    expect(dimensions.main.width).toBe(390);
    const viewer = await memberContext.newPage(); await login(viewer, member); viewer.setDefaultTimeout(10_000); progress("member logged in"); await viewer.goto("/projects?view=discovery");
    await expect(viewer.getByRole("button", { name: /^上移 / })).toHaveCount(0);
    await expect(viewer.getByRole("button", { name: "编辑项目信息", exact: true })).toHaveCount(0);
    const deniedEdit = await memberContext.request.patch(`/api/v1/candidates/${candidates[1].id}`, { headers: { origin, "idempotency-key": randomUUID() }, data: { expectedVersion: editedCandidate.version, companyName: "越权修改", track: "半导体", summary: "普通成员不能修改项目。", investorNames: [], eventDate: null, round: null, amountText: null } });
    expect(deniedEdit.status()).toBe(403);
    const denied = await memberContext.request.patch("/api/v1/candidates/order", { headers: { origin, "idempotency-key": randomUUID() }, data: { move: { id: candidates[0].id, expectedVersion: 1, direction: "up" } } });
    expect(denied.status()).toBe(403);
  } finally { await adminContext.close(); await memberContext.close(); }
});
