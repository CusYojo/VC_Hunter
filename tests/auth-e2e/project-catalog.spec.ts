import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { readAuthFixture } from "./fixtures";
import { login } from "./login";
const origin = "http://127.0.0.1:3107";
test("all projects preserves deferred records and filters the timeline by category, track, dates and any owner", async ({ browser }) => {
  const { admin, member } = readAuthFixture();
  const context = await browser.newContext({ baseURL: origin });
  try {
    const page = await context.newPage(); page.setDefaultTimeout(15_000); await login(page, admin);
    const ids: Record<string, string> = {};
    for (const [status, name] of [["dd", "目录尽调"], ["invested", "目录已投"], ["exited", "目录退出"], ["pass", "目录暂缓"]]) {
      const response = await context.request.post("/api/v1/projects", { headers: { origin, "idempotency-key": randomUUID() }, data: { name, track: "半导体", status, executiveSummary: "目录验收项目真实测试记录" } });
      expect(response.status()).toBe(201); const project = (await response.json()).data; ids[status] = project.id;
      const assigned = await context.request.patch(`/api/v1/projects/${project.id}/assignment`, { headers: { origin, "idempotency-key": randomUUID() }, data: { expectedVersion: project.version, assignees: [admin.name, member.name] } }); expect(assigned.ok()).toBe(true);
    }
    const uploaded = await context.request.post("/api/v1/candidates", { headers: { origin, "idempotency-key": randomUUID() }, multipart: { data: JSON.stringify({ companyName: "目录暂不跟进线索", track: "半导体", summary: "保留待评估的芯片资料", investorNames: "", sourceText: "隔离验收" }), file: { name: "目录原件.txt", mimeType: "text/plain", buffer: Buffer.from("目录验收原始文件") } } });
    expect(uploaded.status()).toBe(201); const candidate = (await uploaded.json()).data;
    expect((await context.request.patch(`/api/v1/candidates/${candidate.id}/review`, { headers: { origin, "idempotency-key": randomUUID() }, data: { expectedVersion: candidate.version, decision: "reject", reason: "暂不跟进" } })).ok()).toBe(true);
    const db = new DatabaseSync(join(process.env.VC_HUNTER_AUTH_E2E_DIRECTORY!, "business.db"));
    try {
      for (const [index, id] of Object.values(ids).entries()) {
        const at = `2026-09-0${index + 1}T02:00:00.000Z`;
        db.prepare("UPDATE platform_timeline SET created_at=? WHERE project_id=?").run(at, id);
        db.prepare("UPDATE projects SET latest_event_at=?,discovery_at=? WHERE id=?").run(at, at, id);
      }
    } finally { db.close(); }
    await page.goto("/projects");
    await expect(page.getByRole("heading", { name: "目录暂缓", exact: true })).toHaveCount(0);
    await page.goto("/more"); await page.getByRole("main").getByRole("link", { name: /全部项目/ }).click();
    await expect(page.getByRole("heading", { name: "全部项目", exact: true })).toBeVisible();
    const apply = async () => { await page.getByRole("button", { name: "应用筛选", exact: true }).click(); await page.waitForLoadState("networkidle"); };
    await page.getByLabel("搜索项目", { exact: true }).fill("目录"); await apply();
    await expect(page.getByRole("heading", { name: "目录暂缓", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "目录暂不跟进线索", exact: true })).toBeVisible();
    const dates = await page.locator('[aria-label="项目时间线"] time').evaluateAll(items => items.map(item => Date.parse(item.getAttribute("datetime")!)));
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
    const row = page.locator(`[data-catalog-id="${candidate.id}"]`); await row.locator("summary").click();
    const original = await context.request.get(`/api/v1/candidates/${candidate.id}/document?download=1`); expect(original.ok()).toBe(true); expect((await original.body()).toString()).toBe("目录验收原始文件");
    for (const [category, title] of [["following", "目录尽调"], ["invested", "目录已投"], ["exited", "目录退出"], ["stopped", "目录暂缓"], ["other", "目录暂不跟进线索"]]) {
      await page.getByRole("combobox", { name: /^项目类别/ }).selectOption(category); await apply();
      await expect(page.locator('[aria-label="项目时间线"] h2')).toHaveText([title]);
    }
    await page.getByRole("combobox", { name: /^项目类别/ }).selectOption("all");
    await page.getByRole("combobox", { name: /^赛道/ }).selectOption("半导体");
    await page.getByRole("combobox", { name: /^负责人/ }).selectOption(member.name);
    await page.getByLabel("开始日期", { exact: true }).fill("2026-09-02"); await page.getByLabel("结束日期", { exact: true }).fill("2026-09-03"); await apply();
    await expect(page.locator('[aria-label="项目时间线"] h2')).toHaveText(["目录退出", "目录已投"]);
    await page.screenshot({ path: "/tmp/vc-project-catalog-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.locator("main").evaluate(element => getComputedStyle(element).paddingLeft)).toBe("0px");
    await expect.poll(() => page.getByRole("form", { name: "筛选全部项目" }).evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(350);
    await expect(page.getByLabel("项目类别")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: "/tmp/vc-project-catalog-mobile.png", fullPage: true });
  } finally { await context.close(); }
});
