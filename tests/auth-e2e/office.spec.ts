import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { readAuthFixture } from "./fixtures";
import { login } from "./login";
import type { OfficeWorkspace } from "../../src/organization/office-contracts";

const origin = "http://127.0.0.1:3107";
async function write(api: APIRequestContext, path: string, data: unknown, method: "POST" | "PATCH" = "POST") {
  const result = await api.fetch(`/api/v1${path}`, { method, headers: { origin, "idempotency-key": randomUUID() }, data });
  expect(result.ok(), `${method} ${path}`).toBe(true);
  return (await result.json()).data;
}

test("team office groups real projects, persists desks and publishes only approved pixel avatars", async ({ browser }) => {
  test.setTimeout(180_000);
  const { admin, member } = readAuthFixture();
  // The isolated auth runner creates login memberships; this scenario also needs personnel records.
  const directoryDb = new DatabaseSync(join(process.env.VC_HUNTER_AUTH_E2E_DIRECTORY!, "auth.db"));
  try {
    for (const account of [admin, member]) {
      const membership = directoryDb.prepare("SELECT user_id FROM workspace_memberships WHERE team_user_id=?").get(account.teamUserId)!;
      directoryDb.prepare("INSERT INTO organization_members(id,tenant_id,account_id,name,title,is_placeholder) VALUES(?,?,?,?,?,0)").run(account.teamUserId, "isolated-auth-e2e", String(membership.user_id), account.name, "团队成员");
    }
  } finally { directoryDb.close(); }
  const adminContext = await browser.newContext({ baseURL: origin });
  const memberContext = await browser.newContext({ baseURL: origin });
  try {
    const adminPage = await adminContext.newPage(), memberPage = await memberContext.newPage();
    await login(adminPage, admin); await login(memberPage, member);
    const investment = await write(adminContext.request, "/admin/departments", { name: "办公室测试投资部", parentId: null, expectedHeadcount: null, notes: "", sortOrder: 100 });
    const finance = await write(adminContext.request, "/admin/departments", { name: "办公室测试财务部", parentId: null, expectedHeadcount: null, notes: "", sortOrder: 101 });
    const directory = (await (await adminContext.request.get("/api/v1/admin/organization")).json()).data;
    for (const [id, departmentId] of [[admin.teamUserId, finance.id], [member.teamUserId, investment.id]]) {
      const person = directory.members.find((item: { id: string }) => item.id === id);
      await write(adminContext.request, `/admin/members/${id}`, { expectedVersion: person.version, departmentId }, "PATCH");
    }
    const projects: Array<{ id: string; name: string; version: number }> = [];
    for (const name of ["星河机器人办公室验收", "远山半导体办公室验收"]) {
      const project = await write(adminContext.request, "/projects", { name, track: "AI", status: "dd" });
      await write(adminContext.request, `/projects/${project.id}/assignment`, { expectedVersion: project.version, assignees: [member.name, admin.name] }, "PATCH");
      await write(adminContext.request, `/projects/${project.id}/milestones`, { stage: "dd", title: "完成技术访谈", status: "done", ownerId: member.teamUserId });
      projects.push(project);
    }
    await write(adminContext.request, "/activity", { kind: "task", title: "办公室预算核对", participantIds: [admin.teamUserId], projectId: projects[0].id });

    await adminPage.goto("/organization");
    await adminPage.getByRole("link", { name: /团队办公室/ }).click();
    await expect(adminPage.getByRole("heading", { name: "团队办公室" })).toBeVisible();
    await expect(adminPage.getByRole("button", { name: "按部门", exact: true })).toHaveAttribute("aria-pressed", "true");
    await adminPage.getByRole("button", { name: "按项目", exact: true }).click();
    await expect(adminPage.getByRole("button", { name: "按项目", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(adminPage.getByRole("button", { name: `查看${member.name}的工作 · ${projects[0].name}` })).toBeVisible();
    await expect(adminPage.getByRole("button", { name: `查看${member.name}的工作 · ${projects[1].name}` })).toHaveCount(0);
    await adminPage.getByRole("button", { name: "传统列表", exact: true }).click();
    await expect(adminPage.getByText("办公室预算核对", { exact: true }).first()).toBeVisible();
    await expect(adminPage.getByText("完成节点 1/1").first()).toBeVisible();
    await adminPage.getByRole("button", { name: "像素办公室", exact: true }).click();
    await adminPage.screenshot({ path: "/tmp/vc-office-pixel.png", fullPage: true });

    await expect(adminPage.getByRole("slider", { name: "办公室缩放" })).toHaveValue("100");
    await adminPage.getByRole("button", { name: "放大办公室", exact: true }).click();
    await expect(adminPage.getByRole("slider", { name: "办公室缩放" })).toHaveValue("110");
    await adminPage.getByRole("button", { name: "适应屏幕", exact: true }).click();
    const map = adminPage.getByLabel("像素办公室，可滚动查看所有小组", { exact: true });
    await expect.poll(() => map.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    const approval = await write(memberContext.request, "/activity", { kind: "approval", title: "办公室行走审批", participantIds: [admin.teamUserId] });
    await adminPage.getByRole("button", { name: "刷新办公室", exact: true }).click();
    const memberActor = adminPage.locator(`[data-office-person="${member.teamUserId}"]`);
    await expect(memberActor).toHaveAttribute("data-mode", "queue");
    await expect(adminPage.locator("[data-office-footsteps]")).toHaveCount(1);
    await expect(adminPage.getByRole("complementary", { name: "全公司待办" }).getByRole("link", { name: "办公室行走审批" }).first()).toBeVisible();
    await adminPage.screenshot({ path: "/tmp/vc-office-live-queue.png", fullPage: true });
    await write(adminContext.request, `/activity/${approval.id}`, { action: "approved", note: "", expectedVersion: approval.version }, "PATCH");
    await adminPage.getByRole("button", { name: "刷新办公室", exact: true }).click();
    await expect(memberActor).toHaveAttribute("data-mode", "desk");
    await write(memberContext.request, `/activity/${approval.id}/comments`, { body: "批注排队验收" });
    await adminPage.getByRole("button", { name: "刷新办公室", exact: true }).click();
    await expect(memberActor).toHaveAttribute("data-mode", "desk");
    await expect(adminPage.getByText("项目资料审批排队")).toHaveCount(0);
    const inbox = (await (await adminContext.request.get("/api/v1/notifications")).json()).data;
    await write(adminContext.request, "/notifications", { before: inbox.snapshotAt }, "PATCH");
    await adminPage.getByRole("button", { name: "刷新办公室", exact: true }).click();
    await expect(memberActor).toHaveAttribute("data-mode", "desk");
    const meeting = await write(adminContext.request, "/activity", { kind: "meeting", title: "办公室会议室验收", participantIds: [member.teamUserId], dueAt: new Date(Date.now() - 2000).toISOString() });
    await adminPage.getByRole("button", { name: "刷新办公室", exact: true }).click();
    await expect(adminPage.getByRole("region", { name: "会议室 · 办公室会议室验收" })).toBeVisible();
    await expect(memberActor).toHaveAttribute("data-mode", "meeting");
    const meetingRoom = adminPage.getByRole("region", { name: "会议室 · 办公室会议室验收" });
    await meetingRoom.scrollIntoViewIfNeeded();
    await expect.poll(() => memberActor.evaluate((actor, meetingId) => { const target = document.querySelector(`[data-office-meeting-seat="${meetingId}"][data-member="${actor.getAttribute("data-office-person")}"]`)!; const a = actor.getBoundingClientRect(), b = target.getBoundingClientRect();return a.left >= b.left && a.right <= b.right + 1 && a.top >= b.top && a.bottom <= b.bottom + 1; }, meeting.id)).toBe(true);
    await adminPage.screenshot({ path: "/tmp/vc-office-live-meeting.png", fullPage: true });
    const forbiddenEnd = await memberContext.request.post(`/api/v1/activity/${meeting.id}/complete-meeting`, { headers: { origin }, data: { expectedVersion: meeting.version } });
    expect(forbiddenEnd.status()).toBe(403);
    await adminPage.getByRole("button", { name: "结束会议：办公室会议室验收", exact: true }).click();
    await expect(adminPage.getByRole("region", { name: "会议室 · 办公室会议室验收" })).toHaveCount(0);
    await expect(memberActor).toHaveAttribute("data-mode", "desk");

    await memberPage.goto("/organization/office");
    await expect(memberPage.getByRole("button", { name: "调整布局", exact: true })).toHaveCount(0);
    await memberPage.getByRole("button", { name: "我的工位", exact: true }).click();
    await memberPage.getByRole("button", { name: "自定义我的展示", exact: true }).click();
    await memberPage.getByLabel("办公室展示项目", { exact: true }).selectOption(projects[1].id);
    await memberPage.getByLabel("办公室个人描述", { exact: true }).fill("正在客户现场推进访谈");
    await memberPage.getByLabel("办公室状态", { exact: true }).selectOption("trip");
    await memberPage.getByRole("button", { name: "保存个人展示", exact: true }).click();
    await expect(memberPage.getByText("个人展示已保存")).toBeVisible();
    await memberPage.getByRole("button", { name: "自定义我的工位", exact: true }).click();
    await memberPage.getByLabel("工位颜色", { exact: true }).fill("#668877");
    await memberPage.getByLabel("工位形状", { exact: true }).selectOption("corner");
    await memberPage.getByRole("button", { name: "保存工位", exact: true }).click();
    await expect(memberPage.getByText("工位外观已保存")).toBeVisible();
    await memberPage.reload();
    const changed = (await (await memberContext.request.get("/api/v1/organization/office")).json()).data as OfficeWorkspace;
    expect(changed.members.find(item => item.id === member.teamUserId)?.style).toMatchObject({ deskColor: "#668877", deskShape: "corner" });
    expect(changed.members.find(item => item.id === member.teamUserId)?.profile).toMatchObject({ displayedProjectId: projects[1].id, description: "正在客户现场推进访谈", presenceStatus: "trip" });

    await adminPage.getByRole("button", { name: "刷新办公室", exact: true }).click();
    await adminPage.getByRole("button", { name: "调整布局", exact: true }).click();
    const groupSelect = adminPage.getByLabel("调整小组", { exact: true });
    await groupSelect.selectOption(`project:${projects[1].id}`);
    await adminPage.getByLabel(`${member.name}工位列`, { exact: true }).fill("3");
    await adminPage.getByRole("button", { name: "保存布局", exact: true }).click();
    await expect(adminPage.getByText("办公室布局已保存")).toBeVisible();
    await adminPage.reload();
    const positioned = (await (await adminContext.request.get("/api/v1/organization/office")).json()).data as OfficeWorkspace;
    expect(positioned.groups.find(group => group.id === `project:${projects[1].id}`)?.seats.find(seat => seat.memberId === member.teamUserId)?.x).toBe(3);

    const template = await memberContext.request.get("/api/v1/organization/office/avatar-template");
    expect(template.ok()).toBe(true);
    await memberPage.getByRole("button", { name: "我的像素形象", exact: true }).click();
    await memberPage.getByLabel("选择头像 PNG", { exact: true }).setInputFiles({ name: "my-pixel.png", mimeType: "image/png", buffer: await template.body() });
    await memberPage.getByRole("button", { name: "提交头像审核", exact: true }).click();
    await expect(memberPage.getByText("已提交，审核通过后会显示在办公室。")).toBeVisible();
    const pending = (await (await memberContext.request.get("/api/v1/organization/office/avatar")).json()).data.item;
    const unpublished = (await (await memberContext.request.get("/api/v1/organization/office")).json()).data as OfficeWorkspace;
    expect(unpublished.members.find(item => item.id === member.teamUserId)?.style.avatarUrl).toBeNull();
    const forbiddenReview = await memberContext.request.patch(`/api/v1/admin/organization/office/avatars/${pending.id}`, { headers: { origin }, data: { expectedVersion: 1, decision: "approve", note: "" } });
    expect(forbiddenReview.status()).toBe(403);
    await adminPage.getByRole("button", { name: "形象与审核", exact: true }).click();
    await adminPage.getByRole("button", { name: `批准${member.name}的头像`, exact: true }).click();
    await expect(adminPage.getByRole("button", { name: `批准${member.name}的头像`, exact: true })).toHaveCount(0);
    await memberPage.reload();
    const published = (await (await memberContext.request.get("/api/v1/organization/office")).json()).data as OfficeWorkspace;
    const imageUrl = published.members.find(item => item.id === member.teamUserId)?.style.avatarUrl;
    expect(imageUrl).toBe(pending.avatarUrl);
    expect((await memberContext.request.get(imageUrl!)).headers()["content-type"]).toContain("image/png");
    const live = (await (await adminContext.request.get("/api/v1/organization/office")).json()).data as OfficeWorkspace;
    const stressMembers = Array.from({ length: 17 }, (_, index) => ({ ...live.members[0], id: `queue-person-${index}`, name: `排队成员${index + 1}`, projects: [], tasks: [], groupIds: ["department:queue"] }));
    const stress = { ...live, members: stressMembers, groups: [{ ...live.groups[0], id: "department:queue", label: "长队列验收", kind: "department", projectId: null, seats: stressMembers.map((person, index) => ({ memberId: person.id, x: index % 4, y: Math.floor(index / 4) })) }], activity: { todos: [], meetings: [], queues: stressMembers.slice(0, 16).map(person => ({ id: `queue-${person.id}`, kind: "approval", fromMemberId: person.id, toMemberId: stressMembers[16].id, title: "审批", targetUrl: "/work", createdAt: "2026-09-04" })) } };
    await adminPage.route("**/api/v1/organization/office", route => route.fulfill({ json: { data: stress } }));
    await adminPage.reload();
    await expect(adminPage.locator('[data-mode="queue"]')).toHaveCount(16);
    await expect(adminPage.locator("[data-office-queue-seat]")).toHaveCount(16);
    await expect.poll(() => adminPage.locator('[data-mode="queue"]').evaluateAll(actors => actors.every(actor => { const root = actor.parentElement!.getBoundingClientRect(), bounds = actor.getBoundingClientRect(); return bounds.left >= root.left && bounds.right <= root.right + 1 && bounds.top >= root.top && bounds.bottom <= root.bottom + 1; }))).toBe(true);
    await adminPage.unroute("**/api/v1/organization/office");
    await memberPage.setViewportSize({ width: 390, height: 844 });
    await expect(memberPage.getByRole("heading", { name: "团队办公室" })).toBeVisible();
    await memberPage.getByRole("button", { name: "传统列表", exact: true }).click();
    expect(await memberPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await memberPage.evaluate(() => window.scrollTo(0, 0));
    await memberPage.screenshot({ path: "/tmp/vc-office-mobile.png", fullPage: true });
  } finally { await adminContext.close(); await memberContext.close(); }
});
