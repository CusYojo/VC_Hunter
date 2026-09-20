import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import { OfficeRepository } from "@/organization/office-repository";
import type { PublicDirectory } from "@/organization/contracts";
import type { OfficeActor } from "@/organization/office-contracts";
import { WorkspaceActivityRepository } from "@/repositories/workspace-activity";
import { SqliteDealTimelineRepository } from "@/workbench/deal-timeline";

const department = (id: string, name: string) => ({ id, name, parentId: null, expectedHeadcount: null, notes: "", sortOrder: 0, version: 1 });
const member = (id: string, departmentId: string) => ({ id, departmentId, name: id, title: "成员", active: true, isPlaceholder: false, version: 1 });
const directory: PublicDirectory = { departments: [department("invest", "投资部"), department("finance", "财务部")], members: [member("alice", "invest"), member("bob", "finance"), { ...member("disabled", "invest"), active: false }] };
const actor: OfficeActor = { tenantId: "tenant", memberId: "alice", accountId: "account-a", canManage: true };
let db: DatabaseSync; let office: OfficeRepository;
beforeEach(() => { db = createDatabase(":memory:"); initializeDatabase(db); seedDemoData(db); office = new OfficeRepository(db); });
afterEach(() => db.close());

describe("organization office", () => {
  it("derives department groups by default while preserving member project memberships", () => {
    db.prepare("DELETE FROM project_responsibles").run();
    db.prepare("INSERT INTO project_responsibles VALUES(?,?,?,?,?)").run("project-qiongxin", "old name", "alice", 0, "2026-09-01");
    db.prepare("INSERT INTO project_responsibles VALUES(?,?,?,?,?)").run("project-xinglan", "bob", "bob", 0, "2026-09-01");
    const result = office.workspace(actor, directory);
    expect(result.members.map(item => item.id)).toEqual(["alice", "bob"]);
    expect(result.groups.find(item => item.id === "department:invest")?.seats.map(item => item.memberId)).toEqual(["alice"]);
    expect(result.groups.find(item => item.id === "department:finance")?.seats.map(item => item.memberId)).toEqual(["bob"]);
    expect(result.members.find(item => item.id === "bob")?.projects).toHaveLength(1);
  });
  it("saves only the current member style with optimistic concurrency", () => {
    expect(office.updateStyle(actor, directory, { expectedVersion: 1, deskColor: "#123456", deskShape: "corner" })).toMatchObject({ deskColor: "#123456", version: 2 });
    expect(office.workspace(actor, directory).members[0].style.deskShape).toBe("corner");
    expect(() => office.updateStyle(actor, directory, { expectedVersion: 1, deskColor: "#ffffff", deskShape: "classic" })).toThrow(/更新/);
    expect(() => office.updateStyle(actor, directory, { expectedVersion: 2, deskColor: "url(x)", deskShape: "classic" })).toThrow();
    expect(() => office.updateStyle(actor, directory, { expectedVersion: 2, memberId: "bob", deskColor: "#ffffff", deskShape: "classic" })).toThrow();
  });
  it("defaults to department view and lets only the signed-in member persist a public office profile", () => {
    db.prepare("DELETE FROM project_responsibles").run();
    db.prepare("INSERT INTO project_responsibles VALUES(?,?,?,?,?)").run("project-qiongxin", "alice", "alice", 0, "2026-09-01");
    const initial = office.workspace(actor, directory);
    expect(initial.groupingMode).toBe("department");
    expect(initial.members.find(item => item.id === "alice")?.profile).toMatchObject({
      version: 1, displayedProjectId: null, description: "", presenceStatus: "office", customStatus: "",
    });
    const updated = office.updateProfile(actor, directory, {
      expectedVersion: 1, groupingMode: "project", displayedProjectId: "project-qiongxin",
      description: "正在推进技术尽调", presenceStatus: "trip", customStatus: "",
    });
    expect(updated.groupingMode).toBe("project");
    expect(updated.members.find(item => item.id === "alice")?.profile).toMatchObject({
      version: 2, displayedProjectId: "project-qiongxin", description: "正在推进技术尽调", presenceStatus: "trip",
    });
    expect(updated.groups.filter(group => group.seats.some(seat => seat.memberId === "alice")).map(group => group.id)).toEqual(["project:project-qiongxin"]);
    expect(office.workspace({ ...actor, tenantId: "other" }, directory).groupingMode).toBe("department");
    expect(() => office.updateProfile(actor, directory, {
      expectedVersion: 1, groupingMode: "department", displayedProjectId: null,
      description: "过期写入", presenceStatus: "office", customStatus: "",
    })).toThrow(/更新/);
    expect(() => office.updateProfile(actor, directory, {
      expectedVersion: 2, groupingMode: "project", displayedProjectId: "project-xinglan",
      description: "不能冒充别人的项目", presenceStatus: "custom", customStatus: "专注中", memberId: "bob",
    })).toThrow();
  });
  it("validates custom status and displayed project membership without partially writing", () => {
    expect(() => office.updateProfile(actor, directory, {
      expectedVersion: 1, groupingMode: "department", displayedProjectId: "project-xinglan",
      description: "无权限项目", presenceStatus: "office", customStatus: "",
    })).toThrow(/项目/);
    expect(() => office.updateProfile(actor, directory, {
      expectedVersion: 1, groupingMode: "department", displayedProjectId: null,
      description: "状态不完整", presenceStatus: "custom", customStatus: "",
    })).toThrow();
    expect(office.workspace(actor, directory).members[0].profile.version).toBe(1);
  });
  it("restricts layout edits, persists positions and isolates tenant preferences", () => {
    const input = { expectedVersion: 1, departments: [{ departmentId: "invest", groupingMode: "department" }], seats: [{ groupId: "department:invest", memberId: "alice", x: 4, y: 3 }] };
    expect(() => office.updateLayout({ ...actor, canManage: false }, directory, input)).toThrow(/管理员/);
    expect(office.updateLayout(actor, directory, input).layoutVersion).toBe(2);
    expect(office.workspace(actor, directory).groups.find(group => group.id === "department:invest")?.seats[0]).toEqual({ memberId: "alice", x: 4, y: 3 });
    expect(office.workspace({ ...actor, tenantId: "other" }, directory).layoutVersion).toBe(1);
    expect(() => office.updateLayout(actor, directory, input)).toThrow(/更新/);
    expect(() => office.updateLayout(actor, directory, { ...input, expectedVersion: 2, seats: [{ groupId: "department:invest", memberId: "bob", x: 0, y: 0 }] })).toThrow(/工位/);
  });
  it("reveals only authorized activity titles and never returns private content", () => {
    const activity = new WorkspaceActivityRepository(db, ["alice", "bob", "carol"]);
    activity.create({ kind: "task", title: "保密薪资核算", description: "private salary", participantIds: ["bob"], projectId: "project-qiongxin" }, "carol", "private");
    activity.create({ kind: "task", title: "共同核验", description: "private notes", participantIds: ["bob"] }, "alice", "shared");
    const employee = office.workspace({ ...actor, canManage: false }, directory);
    expect(employee.members.find(member => member.id === "bob")?.tasks.map(task => task.title)).toEqual(["共同核验"]);
    expect(employee.members.find(member => member.id === "bob")?.projects[0].id).toBe("project-qiongxin");
    expect(JSON.stringify(employee)).not.toContain("保密薪资核算");
    expect(JSON.stringify(office.workspace(actor, directory))).not.toContain("private salary");
    expect(office.workspace(actor, directory).members.find(member => member.id === "bob")?.tasks).toHaveLength(2);
  });
  it("removes completed assignments from both the assignee and creator current work", () => {
    const activity = new WorkspaceActivityRepository(db, ["alice", "bob"]);
    const task = activity.create({ kind: "task", title: "已完成工作", participantIds: ["bob"] }, "alice", "finished");
    activity.respond(task.id, { action: "done", expectedVersion: 1 }, "bob");
    expect(office.workspace(actor, directory).members.flatMap(member => member.tasks)).toEqual([]);
  });
  it("removes returned approvals because a review decision has already been made", () => {
    const activity = new WorkspaceActivityRepository(db, ["alice", "bob"]);
    const approval = activity.create({ kind: "approval", title: "需退回申请", participantIds: ["bob"] }, "alice", "returned");
    activity.respond(approval.id, { action: "returned", note: "材料不完整", expectedVersion: 1 }, "bob");
    expect(office.workspace(actor, directory).members.flatMap(member => member.tasks)).toEqual([]);
  });
  it("uses milestones for progress and supports multi-project memberships", () => {
    const timeline = new SqliteDealTimelineRepository(db, [{ id: "alice", name: "alice", role: "成员", tracks: [], subtracks: [], currentLoad: 0 }]);
    timeline.createMilestone("project-qiongxin", { stage: "dd", title: "完成技术核验", status: "done", ownerId: "alice" }, "m1", "alice");
    timeline.createMilestone("project-xinglan", { stage: "dd", title: "访谈中", status: "in_progress", ownerId: "alice" }, "m2", "alice");
    const member = office.workspace(actor, directory).members[0];
    expect(member.groupIds).toEqual(["department:invest"]);
    expect(member.projects).toHaveLength(2);
    expect(member.projects.find(project => project.id === "project-qiongxin")).toMatchObject({ role: "节点负责", progress: { done: 1, total: 1 }, latestUpdate: { title: expect.stringContaining("完成技术核验") } });
  });
  it("does not resolve ambiguous historical names or use disabled members", () => {
    db.prepare("DELETE FROM project_responsibles").run();
    db.prepare("INSERT INTO project_responsibles VALUES(?,?,?,?,?)").run("project-qiongxin", "alice", null, 0, "2026-09-01");
    expect(office.workspace(actor, directory).members[0].projects).toHaveLength(1);
    const duplicated = { ...directory, members: [...directory.members, { ...member("carol", "invest"), name: "alice" }] };
    expect(office.workspace(actor, duplicated).members[0].projects).toHaveLength(0);
    expect(() => office.workspace({ ...actor, memberId: "disabled" }, directory)).toThrow(/有效/);
  });
  it("shows only an approved avatar pointer owned by the same member and tenant", () => {
    db.prepare("INSERT INTO office_avatar_submissions(id,tenant_id,member_id,png_content,created_at) VALUES(?,?,?,?,?)").run("avatar", "tenant", "alice", Buffer.from("test"), "2026-09-01");
    db.prepare("INSERT INTO office_member_styles(tenant_id,member_id,approved_avatar_id) VALUES(?,?,?)").run("tenant", "alice", "avatar");
    expect(office.workspace(actor, directory).members[0].style.avatarUrl).toBeNull();
    db.prepare("UPDATE office_avatar_submissions SET status='approved'").run();
    expect(office.workspace(actor, directory).members[0].style.avatarUrl).toBe("/api/v1/organization/office/avatars/avatar");
    db.prepare("UPDATE office_avatar_submissions SET member_id='bob'").run();
    expect(office.workspace(actor, directory).members[0].style.avatarUrl).toBeNull();
  });
  it("rejects duplicate/invalid departments, seats and overlapping coordinates atomically", () => {
    expect(() => office.updateLayout(actor, directory, { expectedVersion: 1, departments: [{ departmentId: "missing", groupingMode: "department" }] })).toThrow(/部门/);
    expect(() => office.updateLayout(actor, directory, { expectedVersion: 1, departments: [{ departmentId: "invest", groupingMode: "department" }, { departmentId: "invest", groupingMode: "project" }] })).toThrow(/部门/);
    const sameDepartment = { ...directory, members: [member("alice", "invest"), member("bob", "invest")] };
    const seats = [{ groupId: "department:invest", memberId: "alice", x: 1, y: 0 }];
    expect(() => office.updateLayout(actor, sameDepartment, { expectedVersion: 1, seats })).toThrow(/占用/);
    expect(() => office.updateLayout(actor, directory, { expectedVersion: 1, seats: [...seats, ...seats] })).toThrow(/重复/);
    expect(() => office.updateLayout(actor, directory, { expectedVersion: 1, seats: [{ ...seats[0], x: 33 }] })).toThrow();
    expect(office.workspace(actor, directory).layoutVersion).toBe(1);
  });
  it("places newly added members in free seats without overlapping saved layouts", () => {
    office.updateLayout(actor, directory, { expectedVersion: 1, seats: [{ groupId: "department:invest", memberId: "alice", x: 1, y: 0 }] });
    const expanded = { ...directory, members: [...directory.members, member("carol", "invest")] };
    const seats = office.workspace(actor, expanded).groups.find(group => group.id === "department:invest")!.seats;
    expect(new Set(seats.map(seat => `${seat.x}:${seat.y}`)).size).toBe(seats.length);
    expect(seats.find(seat => seat.memberId === "alice")).toMatchObject({ x: 1, y: 0 });
  });
  it("resolves stale saved seat collisions when a former member returns to a group", () => {
    const initial = { ...directory, members: [member("alice", "invest"), member("bob", "invest")] };
    office.updateLayout(actor, initial, { expectedVersion: 1, seats: [{ groupId: "department:invest", memberId: "alice", x: 0, y: 0 }, { groupId: "department:invest", memberId: "bob", x: 1, y: 0 }] });
    const replaced = { ...directory, members: [member("alice", "invest"), member("carol", "invest")] };
    office.updateLayout(actor, replaced, { expectedVersion: 2, seats: [{ groupId: "department:invest", memberId: "carol", x: 1, y: 0 }] });
    const returned = { ...initial, members: [...initial.members, member("carol", "invest")] };
    const seats = office.workspace(actor, returned).groups.find(group => group.id === "department:invest")!.seats;
    expect(seats).toHaveLength(3);
    expect(new Set(seats.map(seat => `${seat.x}:${seat.y}`)).size).toBe(3);
    expect(seats.find(seat => seat.memberId === "bob")).toMatchObject({ x: 1, y: 0 });
    expect(seats.find(seat => seat.memberId === "carol")).toMatchObject({ x: 2, y: 0 });
  });
});
