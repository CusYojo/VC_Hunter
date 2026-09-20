import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import { WorkspaceActivityRepository } from "@/repositories/workspace-activity";
import { ActivityCommentsRepository } from "@/repositories/activity-comments";
import { SqliteProjectRepository } from "@/repositories/projects";
import { SqliteDealTimelineRepository } from "@/workbench/deal-timeline";
import { createAdminProject } from "@/workbench/project-admin";
import { loadTeamMembers } from "@/workbench/team";
import { addDocumentAnnotation } from "@/workbench/project-document-annotations";

let db: DatabaseSync;
let activities: WorkspaceActivityRepository;
const members = ["user-demo", "user-linchuan", "user-zhouning"];
const projectId = "project-qiongxin";
const task = { kind: "task", title: "准备尽调材料", participantIds: ["user-linchuan"] };
const inbox = (recipient: string) => new SqliteDealTimelineRepository(db, loadTeamMembers()).listNotifications(recipient);
beforeEach(() => { db = createDatabase(":memory:"); initializeDatabase(db); seedDemoData(db); activities = new WorkspaceActivityRepository(db, members); });
afterEach(() => db.close());

describe("transactional business event notifications", () => {
  it("notifies assigned participants once, excludes the actor and unrelated members", () => {
    const item = activities.create({ ...task, participantIds: [...task.participantIds, "user-demo", "user-linchuan"] }, "user-demo", "task");
    activities.create({ ...task, participantIds: [...task.participantIds, "user-demo", "user-linchuan"] }, "user-demo", "task");
    expect(inbox("user-linchuan")).toHaveLength(1);
    expect(inbox("user-linchuan")[0]).toMatchObject({ kind: "task_assigned", actorId: "user-demo", targetUrl: `/work?activity=${item.id}`, readAt: null });
    expect(inbox("user-demo")).toEqual([]);
    expect(inbox("user-zhouning")).toEqual([]);
  });
  it("notifies the reviewer of new approval and its applicant of the decision", () => {
    const item = activities.create({ ...task, kind: "approval" }, "user-demo", "approval");
    expect(inbox("user-linchuan")[0]).toMatchObject({ kind: "approval_requested", targetUrl: `/approvals?activity=${item.id}` });
    activities.respond(item.id, { action: "approved", expectedVersion: 1 }, "user-linchuan");
    expect(inbox("user-demo")[0]).toMatchObject({ kind: "approval_decided", actorId: "user-linchuan", message: expect.stringContaining("通过") });
    expect(() => activities.respond(item.id, { action: "approved", expectedVersion: 1 }, "user-linchuan")).toThrow();
    expect(inbox("user-demo")).toHaveLength(1);
  });
  it("notifies participants of edits that reset their responses, but not no-op edits or retries", () => {
    const item = activities.create(task, "user-demo", "task");
    const edit = { ...task, title: "补充尽调资料", expectedVersion: 1 };
    activities.edit(item.id, edit, "user-demo", "edit");
    activities.edit(item.id, edit, "user-demo", "edit");
    activities.edit(item.id, { ...edit, expectedVersion: 2 }, "user-demo", "no-change");
    expect(inbox("user-linchuan")).toHaveLength(2);
    expect(inbox("user-linchuan").some(item => item.kind === "activity_updated")).toBe(true);
  });
  it("sends activity discussion only to active participants and creator", () => {
    const item = activities.create(task, "user-demo", "task");
    const comments = new ActivityCommentsRepository(db, members);
    comments.create(item.id, { body: "请确认材料" }, "user-linchuan", "comment");
    comments.create(item.id, { body: "请确认材料" }, "user-linchuan", "comment");
    expect(inbox("user-demo")).toHaveLength(1);
    expect(inbox("user-demo")[0]).toMatchObject({ kind: "activity_comment", message: expect.stringContaining("请确认材料") });
    expect(inbox("user-zhouning")).toEqual([]);
  });
  it("notifies newly assigned project owners and ordinary project comments without duplicate mentions", () => {
    const projects = new SqliteProjectRepository(db);
    projects.assign({ projectId, expectedVersion: 1, reviewer: "user-demo", requestId: "assign", assignees: ["示例经理", "林川"] });
    expect(inbox("user-linchuan")[0]).toMatchObject({ kind: "project_assigned", projectId });
    projects.assign({ projectId, expectedVersion: 2, reviewer: "user-demo", requestId: "unchanged", assignees: ["示例经理", "林川"] });
    expect(inbox("user-linchuan")).toHaveLength(1);
    const timeline = new SqliteDealTimelineRepository(db, loadTeamMembers());
    timeline.addComment(projectId, { body: "请复核这个项目", milestoneId: null }, "comment", "user-zhouning");
    expect(inbox("user-linchuan").some(item => item.kind === "project_comment")).toBe(true);
    timeline.addComment(projectId, { body: "@林川 请补充资料", milestoneId: null }, "mention", "user-demo");
    expect(inbox("user-linchuan")).toHaveLength(3);
  });
  it("notifies document uploader and owners, including replies, without self or duplicate recipients", () => {
    db.prepare("INSERT INTO project_documents(id,project_id,original_name,document_kind,media_type,byte_length,sha256,storage_key,external_policy,uploaded_by,parse_status,analysis_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run("notification-document", projectId, "资料.txt", "text", "text/plain", 1, "notification-hash", "test.txt", "local_only", "user-demo", "queued", "queued", new Date().toISOString(), new Date().toISOString());
    const actor = { id: "user-linchuan", name: "林川", roles: ["investment_manager"] };
    const first = addDocumentAnnotation(db, projectId, "notification-document", { content: "核实数据" }, actor, "first");
    expect(inbox("user-demo")[0]).toMatchObject({ kind: "document_comment", projectId });
    addDocumentAnnotation(db, projectId, "notification-document", { content: "已核实", parentId: first.items[0].id }, { ...actor, id: "user-demo", name: "示例经理" }, "reply");
    expect(inbox("user-linchuan")[0]).toMatchObject({ kind: "document_comment" });
    addDocumentAnnotation(db, projectId, "notification-document", { content: "已核实", parentId: first.items[0].id }, { ...actor, id: "user-demo", name: "示例经理" }, "reply");
    expect(inbox("user-linchuan")).toHaveLength(1);
  });
  it("broadcasts newly admitted projects once to the current team except the creator", () => {
    const actor = { tenantId: "demo", id: "user-demo", roles: ["org_admin"] };
    const input = { name: "通知测试项目", track: "AI" };
    const project = createAdminProject(db, actor, input, "new-project");
    createAdminProject(db, actor, input, "new-project");
    expect(inbox("user-linchuan")).toHaveLength(1);
    expect(inbox("user-linchuan")[0]).toMatchObject({ kind: "project_created", projectId: project.id, targetUrl: `/projects/${project.id}` });
    expect(inbox("user-zhouning")).toHaveLength(1);
    expect(inbox("user-demo")).toEqual([]);
  });
  it("rolls back the activity when notification persistence fails", () => {
    db.exec("CREATE TRIGGER fail_notification BEFORE INSERT ON member_notifications BEGIN SELECT RAISE(ABORT, 'notification failed'); END;");
    expect(() => activities.create(task, "user-demo", "task")).toThrow("notification failed");
    expect(activities.list("user-demo")).toEqual([]);
    db.exec("DROP TRIGGER fail_notification");
    activities.create(task, "user-demo", "task");
    expect(inbox("user-linchuan")).toHaveLength(1);
  });
});

it("marks only the recipient's unread notifications through the acknowledged snapshot", () => {
  activities.create(task, "user-demo", "earlier");
  activities.create({ ...task, participantIds: ["user-zhouning"] }, "user-demo", "other");
  db.prepare("UPDATE member_notifications SET created_at=?").run("2026-09-04T10:00:00.000Z");
  const prior = inbox("user-linchuan")[0];
  activities.create(task, "user-demo", "later");
  db.prepare("UPDATE member_notifications SET created_at=? WHERE recipient_id=? AND id<>?").run("2026-09-04T10:01:00.000Z", "user-linchuan", prior.id);
  const repository = new SqliteDealTimelineRepository(db, loadTeamMembers());
  expect(repository.markAllNotificationsRead("user-linchuan", "2026-09-04T10:00:00.000Z")).toEqual({ updated: 1 });
  expect(repository.countUnread("user-linchuan")).toBe(1);
  expect(repository.countUnread("user-zhouning")).toBe(1);
  expect(repository.markAllNotificationsRead("user-linchuan", "2026-09-04T10:00:00.000Z")).toEqual({ updated: 0 });
  expect(() => repository.markAllNotificationsRead("user-linchuan", "bad")).toThrow("通知截止时间无效");
});

it("migrates existing notifications without losing read state or ownership", async () => {
  const { notificationsMigration } = await import("@/db/notifications-migration");
  db.exec(notificationsMigration.downSql);
  db.prepare("INSERT INTO member_notifications(id,recipient_id,actor_id,kind,project_id,message,read_at,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run("legacy", "user-linchuan", "user-demo", "mention", projectId, "已有通知", "2026-09-04T10:00:00.000Z", "2026-09-04T09:00:00.000Z");
  db.exec(notificationsMigration.upSql);
  expect(inbox("user-linchuan")).toEqual([expect.objectContaining({ id: "legacy", kind: "mention", message: "已有通知", readAt: "2026-09-04T10:00:00.000Z", targetUrl: `/projects/${projectId}` })]);
});

it("notifies candidate promotion and assignment atomically without repeating on retries", async () => {
  const { SqliteWorkbenchRepository } = await import("@/workbench/repository");
  db.prepare("INSERT INTO web_search_leads(id,url,title,highlights_json,first_seen_at,last_seen_at,status) VALUES (?,?,?,'[]',?,?,'discovered')")
    .run("notice-lead", "https://example.com/notice", "融资线索", "2026-09-04", "2026-09-04");
  db.prepare("INSERT INTO project_candidates(id,lead_id,company_name,track,investor_names_json,signal_type,summary,confidence,status,model,prompt_version,created_at,updated_at,review_version) VALUES (?,?,?,?,'[]','funding','融资',0.8,'pending_review','test','1',?,?,1)")
    .run("notice-candidate", "notice-lead", "候选公司", "AI", "2026-09-04", "2026-09-04");
  const repository = new SqliteWorkbenchRepository(db);
  const input = { decision: "promote", expectedVersion: 1, assignee: "林川" } as const;
  const project = repository.reviewCandidate("notice-candidate", input, "promote", "user-demo");
  repository.reviewCandidate("notice-candidate", input, "promote", "user-demo");
  expect(inbox("user-linchuan").map(item => item.kind).sort()).toEqual(["project_assigned", "project_created"]);
  expect(inbox("user-zhouning")).toEqual([expect.objectContaining({ kind: "project_created", projectId: project.projectId })]);
  expect(inbox("user-demo")).toEqual([]);
});

it.each(["meeting", "trip"])("notifies %s invitations and responses", kind => {
  const item = activities.create({ ...task, kind }, "user-demo", kind);
  expect(inbox("user-linchuan")[0]).toMatchObject({ kind: "activity_invited" });
  activities.respond(item.id, { action: "accepted", expectedVersion: 1 }, "user-linchuan");
  expect(inbox("user-demo")[0]).toMatchObject({ kind: "activity_responded", message: expect.stringContaining("已接受") });
});
