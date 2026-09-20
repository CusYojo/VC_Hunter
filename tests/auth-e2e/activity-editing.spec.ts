import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";
import { expect, test, type APIResponse } from "@playwright/test";
import { readAuthFixture } from "./fixtures";
import { login } from "./login";

const origin = "http://127.0.0.1:3107";
const progress = (step: string) => appendFileSync("/tmp/vc-activity-editing-steps.log", `${step}\n`, { mode: 0o600 });
const shanghaiDate = () => new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Shanghai", year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date());
async function data(response: Pick<APIResponse, "status" | "json">, status: number) {
  const payload = await response.json();
  if (response.status() !== status) throw new Error(`Unexpected HTTP ${response.status()}; code ${payload.error?.code ?? "unknown"}`);
  return payload.data;
}

test("activities need only a title, retain creator edits, and offer real department and recent participants", async ({ browser }) => {
  writeFileSync("/tmp/vc-activity-editing-steps.log", "start\n", { mode: 0o600 });
  const { admin, member } = readAuthFixture();
  // The isolated invite fixture has team.json but no organization directory records.
  const directoryPath = process.env.VC_HUNTER_AUTH_E2E_DIRECTORY!;
  if (process.env.VC_HUNTER_AUTH_DB_PATH !== join(directoryPath, "auth.db") || process.env.VC_HUNTER_CURRENT_TENANT_ID !== "isolated-auth-e2e") throw new Error("Refuse non-isolated organization fixture");
  const fixtureDatabase = new DatabaseSync(join(directoryPath, "auth.db"));
  try {
    for (const account of [admin, member]) {
      const accountRow = fixtureDatabase.prepare("SELECT id FROM user WHERE username=?").get(account.username);
      if (!accountRow) throw new Error("Isolated test account missing");
      fixtureDatabase.prepare("INSERT INTO organization_members(id,tenant_id,account_id,name,title,is_placeholder) VALUES(?,?,?,?,?,0) ON CONFLICT(id) DO NOTHING").run(account.teamUserId, "isolated-auth-e2e", String(accountRow.id), account.name, "投资经理");
    }
  } finally { fixtureDatabase.close(); }
  const authorContext = await browser.newContext({ baseURL: origin });
  const recipientContext = await browser.newContext({ baseURL: origin });
  try {
    const author = await authorContext.newPage(); author.setDefaultTimeout(10_000); await login(author, admin);
    const department = await data(await authorContext.request.post("/api/v1/admin/departments", { headers: { origin }, data: { name: "E2E真实部门", parentId: null, expectedHeadcount: null, notes: "隔离验收", sortOrder: 0 } }), 201);
    const directory = await data(await authorContext.request.get("/api/v1/admin/organization"), 200);
    const recipientRecord = directory.members.find((person: { id: string }) => person.id === member.teamUserId);
    expect(recipientRecord).toBeTruthy();
    await data(await authorContext.request.patch(`/api/v1/admin/members/${member.teamUserId}`, { headers: { origin }, data: { departmentId: department.id, expectedVersion: recipientRecord.version } }), 200);
    progress("real department assigned");
    await author.goto("/work"); await author.getByRole("button", { name: "新建事项", exact: true }).click();
    const time = author.getByLabel("截止或开始时间", { exact: true });
    expect(await time.inputValue()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    const difference = await time.evaluate((element: HTMLInputElement) => Math.abs(Date.now() - new Date(element.value).getTime()));
    expect(difference).toBeLessThan(120_000);
    await expect(time).not.toHaveAttribute("required", "");
    await expect(author.getByRole("group", { name: "E2E真实部门", exact: true }).getByRole("checkbox", { name: member.name, exact: true })).toBeVisible();
    await time.fill("");
    await author.getByLabel("事项标题", { exact: true }).fill("E2E仅标题个人事项");
    const [createdResponse] = await Promise.all([
      author.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/activity" && response.request().method() === "POST"),
      author.getByRole("button", { name: "保存到工作空间", exact: true }).click(),
    ]);
    const created = await data(createdResponse, 200);
    expect(created).toMatchObject({ title: "E2E仅标题个人事项", dueAt: null, responses: [] });
    progress("created without optional inputs");
    const card = (title: string) => author.getByRole("article").filter({ has: author.getByRole("button", { name: `事项概览：${title}`, exact: true }) });
    await expect(card(created.title).getByText("未设置时间", { exact: true })).toBeVisible();
    const summary = card(created.title).getByRole("button", { name: `事项概览：${created.title}`, exact: true });
    await expect(summary).toHaveAttribute("aria-expanded", "false");
    await summary.focus(); await summary.press("Enter");
    await expect(summary).toHaveAttribute("aria-expanded", "true");
    await summary.press("Space");
    await expect(summary).toHaveAttribute("aria-expanded", "false");
    await summary.click();
    await card(created.title).getByRole("button", { name: "编辑事项", exact: true }).click();
    await expect(author.getByRole("heading", { name: "编辑工作事项", exact: true })).toBeVisible();
    await author.getByLabel("事项标题", { exact: true }).fill("E2E事项编辑后");
    await author.getByRole("textbox", { name: /^内容与资料说明/ }).fill("创建后补充的会议安排");
    const calendarDay = shanghaiDate();
    await author.getByLabel("截止或开始时间", { exact: true }).fill(`${calendarDay}T10:30`);
    await author.getByLabel("结束时间", { exact: true }).fill(`${calendarDay}T13:00`);
    await author.getByRole("checkbox", { name: member.name, exact: true }).check();
    const [editedResponse] = await Promise.all([
      author.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/activity/${created.id}/edit` && response.request().method() === "PATCH"),
      author.getByRole("button", { name: "保存修改", exact: true }).click(),
    ]);
    const edited = await data(editedResponse, 200);
    expect(edited.title).toBe("E2E事项编辑后"); expect(edited.description).toBe("创建后补充的会议安排");
    expect(new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Shanghai", hour:"2-digit", minute:"2-digit", hourCycle:"h23" }).format(new Date(edited.endAt))).toBe("13:00");
    expect(edited.updatedAt).not.toBe(created.createdAt);
    expect(Date.parse(edited.updatedAt)).toBeGreaterThan(Date.parse(created.createdAt));
    expect(edited.responses.map((response: { memberId: string }) => response.memberId)).toEqual([member.teamUserId]);
    await author.reload();
    const calendarEvent = author.getByRole("gridcell", { name:`${calendarDay}日程` }).getByRole("button", { name:/E2E事项编辑后，10:30至13:00/ });
    await expect(calendarEvent).toBeVisible();
    await calendarEvent.click();
    await expect(author.getByRole("dialog", { name:/E2E事项编辑后/ })).toBeVisible();
    await author.getByRole("button", { name:"Close" }).click();
    await author.getByRole("button", { name:"上一周" }).click();
    await expect(author.getByRole("button", { name:/E2E事项编辑后，10:30至13:00/ })).toHaveCount(0);
    await author.getByRole("button", { name:"今天", exact:true }).click();
    progress("weekly calendar persists multi-hour span and navigation");
    const saved = card(edited.title);
    await saved.getByRole("button", { name: `事项概览：${edited.title}`, exact: true }).click();
    await expect(saved.getByText("创建后补充的会议安排", { exact: true })).toBeVisible();
    await expect(saved.getByText(/^最后编辑：/)).toBeVisible();
    const listed = await data(await authorContext.request.get("/api/v1/activity"), 200);
    expect(listed.find((item: { id: string }) => item.id === created.id)).toMatchObject({ title: edited.title, description: edited.description, dueAt: edited.dueAt, updatedAt: edited.updatedAt });
    progress("edit fields and edit timestamp persist");
    await author.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => author.locator("#main-content").evaluate(element => getComputedStyle(element).paddingLeft)).toBe("0px");
    await expect.poll(() => author.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const calendarScroller = author.getByTestId("calendar-week-scroll");
    await expect(calendarScroller).toBeVisible();
    expect(await calendarScroller.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    await author.getByRole("heading", { name:"日程", exact:true }).evaluate(element => element.closest("section")?.scrollIntoView({ block:"start" }));
    await author.evaluate(() => window.scrollBy(0, -72));
    await calendarScroller.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    await author.screenshot({ path: "/tmp/vc-activity-calendar-mobile.png", animations: "disabled" });
    await author.getByRole("button", { name: "新建事项", exact: true }).click();
    const recent = author.getByRole("group", { name: "最近选择", exact: true });
    await expect(recent.getByRole("checkbox", { name: member.name, exact: true })).toBeVisible();
    await expect(author.getByRole("checkbox", { name: member.name, exact: true })).toHaveCount(1);
    await author.getByRole("button", { name: "取消", exact: true }).click();
    progress("recent participant persists and mobile fits");
    const recipient = await recipientContext.newPage(); recipient.setDefaultTimeout(10_000); await login(recipient, member); await recipient.goto("/work");
    const received = recipient.getByRole("article").filter({ has: recipient.getByRole("button", { name: `事项概览：${edited.title}`, exact: true }) });
    await received.getByRole("button", { name: `事项概览：${edited.title}`, exact: true }).click();
    await expect(received).toBeVisible(); await expect(received.getByRole("button", { name: "编辑事项", exact: true })).toHaveCount(0);
    const denied = await recipientContext.request.patch(`/api/v1/activity/${created.id}/edit`, { headers: { origin, "idempotency-key": randomUUID() }, data: { kind: edited.kind, title: "禁止接收人篡改", description: "", dueAt: null, participantIds: [], location: "", projectId: null, expectedVersion: edited.version } });
    expect(denied.status()).toBe(403);
    await recipient.getByRole("button", { name: "新建事项", exact: true }).click();
    await expect(recipient.getByRole("group", { name: "最近选择", exact: true })).toHaveCount(0);
    progress("recipient cannot edit and has independent recent contacts");
  } finally { await authorContext.close(); await recipientContext.close(); }
});
