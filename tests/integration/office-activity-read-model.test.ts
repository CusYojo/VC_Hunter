import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import { readOfficeWorkspace } from "@/organization/office-read-model";
import type { OfficeActor } from "@/organization/office-contracts";
import type { PublicDirectory } from "@/organization/contracts";
import { WorkspaceActivityRepository } from "@/repositories/workspace-activity";
import { completeMeeting } from "@/workbench/meeting-completion";
import { insertNotifications } from "@/workbench/notifications";
import { SqliteDealTimelineRepository } from "@/workbench/deal-timeline";
import { ActivityCommentsRepository } from "@/repositories/activity-comments";

const members = ["alice", "bob", "carol", "disabled"];
const directory: PublicDirectory = { departments: [], members: members.map(id => ({ id, name: id, title: "员工", departmentId: null, version: 1, active: id !== "disabled", isPlaceholder: false })) };
const admin: OfficeActor = { tenantId: "tenant", accountId: "a", memberId: "alice", canManage: true };
const now = new Date("2026-09-04T08:00:00Z");
let db: DatabaseSync;
let activities: WorkspaceActivityRepository;
const read = (actor = admin, at = now) => readOfficeWorkspace(db, actor, directory, at).activity!;
const create = (kind: "task" | "approval" | "meeting" = "task", participantIds = ["bob"], creator = "alice", dueAt = "2026-09-04T08:00:00Z") => activities.create({ kind, title: `${kind} title`, description: "private description", participantIds, dueAt }, creator, crypto.randomUUID());
const setAction = (id: string, member: string, action: string) => db.prepare("UPDATE workspace_activity_responses SET action=? WHERE activity_id=? AND member_id=?").run(action, id, member);
beforeEach(() => { db = createDatabase(":memory:"); initializeDatabase(db); seedDemoData(db); activities = new WorkspaceActivityRepository(db, members); });
afterEach(() => db.close());

describe("office live activity projection", () => {
  it("shows one todo per activity with outstanding active recipients, protects private titles", () => {
    const task = create("task", ["bob", "carol", "disabled"]);
    setAction(task.id, "carol", "done");
    const privateTask = create("task", ["bob"], "carol");
    expect(read().todos).toEqual(expect.arrayContaining([expect.objectContaining({ id: task.id, memberIds: ["bob"] }), expect.objectContaining({ id: privateTask.id })]));
    expect(read({ ...admin, canManage: false }).todos.map(item => item.id)).toEqual([task.id]);
    expect(JSON.stringify(read())).not.toContain("private description");
    setAction(task.id, "bob", "done");
    expect(read().todos.map(item => item.id)).not.toContain(task.id);
  });
  it("caps todo rows at 100 without duplicating participants", () => {
    for (let index = 0; index < 105; index++) create("task", ["bob", "carol"]);
    expect(read().todos).toHaveLength(100);
    expect(new Set(read().todos.map(item => item.id)).size).toBe(100);
  });
  it("queues every pending project-document approver with a distinct active recipient", () => {
    const item = create("approval", ["bob", "carol"]);
    for (const id of ["disabled", "alice"]) db.prepare("INSERT INTO workspace_activity_responses(activity_id,member_id) VALUES(?,?)").run(item.id, id);
    expect(read().queues).toEqual([
      expect.objectContaining({ kind: "approval", fromMemberId: "alice", toMemberId: "bob", targetUrl: `/approvals?activity=${item.id}` }),
      expect.objectContaining({ kind: "approval", fromMemberId: "alice", toMemberId: "carol", targetUrl: `/approvals?activity=${item.id}` }),
    ]);
    setAction(item.id, "carol", "returned");
    expect(read().queues).toEqual([expect.objectContaining({ kind: "approval", fromMemberId: "alice", toMemberId: "bob" })]);
    setAction(item.id, "bob", "approved");
    expect(read().queues).toEqual([]);
    expect(read({ ...admin, memberId: "carol", canManage: false }).queues).toEqual([]);
  });
  it("hides unrelated approvals from ordinary employees", () => {
    create("approval", ["bob"], "carol");
    expect(read().queues).toHaveLength(1);
    expect(read({ ...admin, canManage: false }).queues).toHaveLength(0);
  });
  it("moves meetings at their start time and returns finished or declined members", () => {
    const item = create("meeting", ["bob", "carol", "disabled"]);
    expect(read(admin, new Date(now.getTime() - 1)).meetings).toEqual([]);
    expect(read().meetings).toEqual([expect.objectContaining({ id: item.id, memberIds: ["alice", "bob", "carol"], startsAt: now.toISOString() })]);
    activities.respond(item.id, { action: "declined", expectedVersion: 1 }, "carol");
    expect(read().meetings[0].memberIds).toEqual(["alice", "bob"]);
    completeMeeting(db, item.id, { expectedVersion: 2 }, admin, members);
    expect(read().meetings).toEqual([]);
  });
  it("does not invent meeting duration or show invalid or absent start dates", () => {
    const item = create("meeting");
    expect(read(admin, new Date("2026-10-04T08:00:00Z")).meetings).toHaveLength(1);
    setAction(item.id, "bob", "change_requested");
    expect(read().meetings).toEqual([]);
    setAction(item.id, "bob", "accepted");
    db.prepare("UPDATE workspace_activity SET due_at='invalid' WHERE id=?").run(item.id);
    expect(read().meetings).toEqual([]);
  });
  it("derives unread comment queues from existing comments, deduplicates and never exposes text", () => {
    const item = create("task", ["bob", "carol"]);
    const comments = new ActivityCommentsRepository(db, members);
    const comment = comments.create(item.id, { body: "confidential comment body" }, "alice", "comment");
    db.prepare(`INSERT INTO member_notifications SELECT 'duplicate',recipient_id,actor_id,kind,project_id,milestone_id,comment_id,message,target_url,read_at,created_at FROM member_notifications WHERE kind='activity_comment' AND recipient_id='bob'`).run();
    expect(read().queues.filter(item => item.kind === "comment")).toHaveLength(2);
    expect(read({ ...admin, memberId: "bob", canManage: false }).queues).toEqual([expect.objectContaining({ kind: "comment", fromMemberId: "alice", toMemberId: "bob" })]);
    expect(JSON.stringify(read().queues)).not.toContain("confidential");
    db.prepare("UPDATE member_notifications SET read_at=? WHERE comment_id=?").run(now.toISOString(), comment.id);
    expect(read().queues).toHaveLength(0);
  });
  it("projects @mentioned project comments once and withdraws them on read or deletion", () => {
    const repository = new SqliteDealTimelineRepository(db, members.map(id => ({ id, name: id, role: "员工", tracks: [], subtracks: [], currentLoad: 0 })));
    const comment = repository.addComment("project-qiongxin", { body: "sensitive @bob" }, "mention", "alice");
    expect(db.prepare("SELECT kind FROM member_notifications WHERE comment_id=? AND recipient_id='bob'").get(comment.id)?.kind).toBe("mention");
    const recipient = { ...admin, memberId: "bob", canManage: false };
    expect(read(recipient).queues).toEqual([expect.objectContaining({ kind: "comment", title: "项目批注待查看", fromMemberId: "alice", toMemberId: "bob", targetUrl: "/projects/project-qiongxin" })]);
    insertNotifications(db, { recipientIds: ["bob"], actorId: "alice", kind: "project_comment", projectId: "project-qiongxin", commentId: comment.id, message: "sensitive duplicate", targetUrl: "/irrelevant", createdAt: now.toISOString() });
    expect(read().queues).toHaveLength(1);
    expect(JSON.stringify(read(recipient).queues)).not.toContain("sensitive");
    expect(read({ ...admin, memberId: "carol", canManage: false }).queues).toEqual([]);
    db.prepare("UPDATE member_notifications SET read_at=? WHERE comment_id=?").run(now.toISOString(), comment.id);
    expect(read(recipient).queues).toEqual([]);
    db.prepare("UPDATE member_notifications SET read_at=NULL WHERE comment_id=?").run(comment.id);
    repository.deleteComment("project-qiongxin", comment.id, "alice");
    expect(read().queues).toEqual([]);
  });
  it("checks current activity access even for stale unread notifications", () => {
    const item = create("task", ["bob", "carol"]);
    new ActivityCommentsRepository(db, members).create(item.id, { body: "private" }, "alice", "comment");
    db.prepare("DELETE FROM workspace_activity_responses WHERE activity_id=? AND member_id='bob'").run(item.id);
    expect(read({ ...admin, memberId: "bob", canManage: false }).queues).toEqual([]);
    expect(read().queues.map(item => item.toMemberId)).toEqual(["carol"]);
    db.prepare("DELETE FROM activity_comments").run();
    expect(read().queues).toEqual([]);
  });
  it("projects only extant matching project and document comments with canonical links", () => {
    db.prepare("INSERT INTO project_comments(id,project_id,author_id,body,idempotency_key,created_at) VALUES(?,?,?,?,?,?)").run("pc", "project-qiongxin", "alice", "sensitive body", "pc", now.toISOString());
    db.prepare("INSERT INTO project_documents(id,project_id,original_name,document_kind,media_type,byte_length,sha256,storage_key,external_policy,uploaded_by,parse_status,analysis_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run("doc", "project-qiongxin", "private-name.txt", "text", "text/plain", 1, "hash", "test.txt", "local_only", "bob", "queued", "queued", now.toISOString(), now.toISOString());
    db.prepare("INSERT INTO project_document_annotations(id,document_id,author_id,author_name,content,action,created_at) VALUES(?,?,?,?,?,?,?)").run("dc", "doc", "alice", "alice", "sensitive document body", "comment", now.toISOString());
    for (const [kind, commentId] of [["project_comment", "pc"], ["document_comment", "dc"]] as const) {
      insertNotifications(db, { recipientIds: ["bob", "disabled"], actorId: "alice", kind, projectId: "project-qiongxin", commentId, message: "sensitive excerpt", targetUrl: "/irrelevant", createdAt: now.toISOString() });
      insertNotifications(db, { recipientIds: ["bob"], actorId: "alice", kind, projectId: "project-xinglan", commentId, message: "mismatched project", targetUrl: "/irrelevant", createdAt: now.toISOString() });
    }
    expect(read().queues).toHaveLength(2);
    expect(read().queues.every(item => item.toMemberId === "bob" && item.targetUrl === "/projects/project-qiongxin")).toBe(true);
    expect(JSON.stringify(read().queues)).not.toMatch(/sensitive|private-name/);
    expect(read({ ...admin, canManage: false }).queues).toHaveLength(0);
    expect(read({ ...admin, memberId: "bob", canManage: false }).queues).toHaveLength(2);
    db.prepare("UPDATE project_document_annotations SET action='approve'").run();
    expect(read().queues).toHaveLength(1);
    db.prepare("DELETE FROM project_comments").run();
    expect(read().queues).toHaveLength(0);
  });
  it("keeps creator-only todos without fabricating a meeting or requiring a due date", () => {
    const item = activities.create({ kind: "task", title: "记录事项", participantIds: [] }, "alice", "solo");
    expect(read().todos).toEqual([expect.objectContaining({ id: item.id, dueAt: null, memberIds: ["alice"] })]);
    create("meeting", []);
    expect(read().meetings).toEqual([]);
    create("approval", ["bob"], "disabled");
    expect(read().queues).toEqual([]);
  });
  it("does not restore the creator after their explicit meeting decline", () => {
    const item = create("meeting", ["alice", "bob"]);
    activities.respond(item.id, { action: "declined", expectedVersion: 1 }, "alice");
    expect(read().meetings[0].memberIds).toEqual(["bob"]);
    completeMeeting(db, item.id, { expectedVersion: 2 }, admin, members);
    expect(read().meetings).toEqual([]);
  });

  it("returns change requests to the creator todo without queueing or attending", () => {
    const item = create("meeting");
    setAction(item.id, "bob", "change_requested");
    expect(read().todos).toEqual([expect.objectContaining({ id: item.id, memberIds: ["alice"] })]);
    expect(read().meetings).toEqual([]);
    expect(read().queues).toEqual([]);
  });
  it("orders dated todos before undated ones", () => {
    const undated = activities.create({ kind: "task", title: "无截止日期", participantIds: ["bob"] }, "alice", "undated");
    const dated = create();
    expect(read().todos.map(item => item.id)).toEqual([dated.id, undated.id]);
  });

});
