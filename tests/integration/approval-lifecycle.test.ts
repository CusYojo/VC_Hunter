import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import { WorkspaceActivityRepository } from "@/repositories/workspace-activity";
import { ActivityCommentsRepository } from "@/repositories/activity-comments";
import { archiveDueApprovals, nextShanghaiMidnight } from "@/workbench/approval-lifecycle";
let db: DatabaseSync; let repository: WorkspaceActivityRepository;
const input = { kind: "approval", title: "报销机票", participantIds: ["reviewer"] };
const file = { name: "invoice.txt", mimeType: "text/plain", bytes: Buffer.from("invoice bytes") };
const create = (extra = {}, key = crypto.randomUUID()) => repository.create({ ...input, ...extra }, "owner", key, [file]);
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-05T15:59:00.000Z")); db = createDatabase(":memory:"); initializeDatabase(db); seedDemoData(db); repository = new WorkspaceActivityRepository(db, ["owner", "reviewer", "other", "admin"]); });
afterEach(() => { db.close(); vi.useRealTimers(); });
it("withdraws pending and returned approvals, freezes original changes and retains attachments and discussion", () => {
  const item = create();
  const withdrawn = repository.lifecycle(item.id, { action: "withdraw", expectedVersion: 1 }, "owner");
  expect(withdrawn).toMatchObject({ status: "withdrawn", withdrawnAt: "2026-09-05T15:59:00.000Z", version: 2 });
  expect(repository.lifecycle(item.id, { action: "withdraw", expectedVersion: 1 }, "owner")).toEqual(withdrawn);
  expect(() => repository.edit(item.id, { ...input, title: "changed", expectedVersion: 2 }, "owner", "edit")).toThrow(/不能再修改/);
  expect(() => repository.respond(item.id, { action: "approved", expectedVersion: 2 }, "reviewer")).toThrow(/不能再修改/);
  expect(() => repository.uploadDocument(item.id, { ...file, expectedVersion: 2 }, "owner", "upload")).toThrow(/不能再修改/);
  expect(() => repository.referenceDocuments(item.id, { projectDocumentIds: ["missing"], expectedVersion: 2 }, "owner", "reference")).toThrow(/不能再修改/);
  expect(Buffer.from(repository.readDocument(item.id, item.documents![0].id, "reviewer").bytes).toString()).toBe("invoice bytes");
  const comments = new ActivityCommentsRepository(db, ["owner", "reviewer"]);
  const comment = comments.create(item.id, { body: "保留历史讨论" }, "reviewer", "comment");
  expect(comments.delete(item.id, comment.id, "reviewer").deletedAt).toBeTruthy();
  expect(repository.list("owner")[0].status).toBe("withdrawn");
  const returned = create(); repository.respond(returned.id, { action: "returned", note: "请补发票", expectedVersion: 1 }, "reviewer");
  expect(repository.lifecycle(returned.id, { action: "withdraw", expectedVersion: 2 }, "owner").status).toBe("withdrawn");
});
it("only an active original sender can transition approvals, regardless of administrator privilege", () => {
  const item = create();
  for (const actor of ["reviewer", "other", "admin"]) expect(() => repository.lifecycle(item.id, { action: "withdraw", expectedVersion: 1 }, actor)).toThrow(/申请人/);
  expect(() => new WorkspaceActivityRepository(db, ["reviewer"]).lifecycle(item.id, { action: "withdraw", expectedVersion: 1 }, "owner")).toThrow(/申请人/);
  expect(() => repository.lifecycle("missing", { action: "withdraw", expectedVersion: 1 }, "owner")).toThrow(/不存在/);
  expect(() => repository.lifecycle(item.id, { action: "withdraw", expectedVersion: 2 }, "owner")).toThrow(/版本/);
  const task = repository.create({ kind: "task", title: "ordinary" }, "owner", "task");
  expect(() => repository.lifecycle(task.id, { action: "withdraw", expectedVersion: 1 }, "owner")).toThrow(/审批/);
});
it("requires every approval before completion and forbids withdrawal once approved", () => {
  const item = create();
  expect(() => repository.lifecycle(item.id, { action: "complete", expectedVersion: 1 }, "owner")).toThrow(/审批通过/);
  repository.respond(item.id, { action: "approved", expectedVersion: 1 }, "reviewer");
  expect(() => repository.lifecycle(item.id, { action: "withdraw", expectedVersion: 2 }, "owner")).toThrow(/审批通过/);
  db.prepare("INSERT INTO workspace_activity_responses(activity_id,member_id) VALUES(?,?)").run(item.id, "other");
  expect(() => repository.lifecycle(item.id, { action: "complete", expectedVersion: 2 }, "owner")).toThrow(/审批通过/);
  repository.respond(item.id, { action: "approved", expectedVersion: 2 }, "other");
  expect(repository.lifecycle(item.id, { action: "complete", expectedVersion: 3 }, "owner")).toMatchObject({ status: "completed", completedAt: expect.any(String), archiveAt: "2026-09-05T16:00:00.000Z", version: 4 });
  const empty = create({ participantIds: [] });
  expect(() => repository.lifecycle(empty.id, { action: "complete", expectedVersion: 1 }, "owner")).toThrow(/审批通过/);
  expect(repository.lifecycle(empty.id, { action: "withdraw", expectedVersion: 1 }, "owner").status).toBe("withdrawn");
});
it("archives at Shanghai midnight exactly once, keeps originals, and accepts an old successful completion retry", () => {
  const item = create(); repository.respond(item.id, { action: "approved", expectedVersion: 1 }, "reviewer");
  const completed = repository.lifecycle(item.id, { action: "complete", expectedVersion: 2 }, "owner");
  expect(archiveDueApprovals(db, new Date("2026-09-05T15:59:59.999Z"))).toBe(0);
  const notificationsBefore = db.prepare("SELECT count(*) AS n FROM member_notifications").get()?.n;
  expect(archiveDueApprovals(db, new Date("2026-09-05T16:00:00.000Z"))).toBe(1);
  expect(archiveDueApprovals(db, new Date("2026-09-06T16:00:00.000Z"))).toBe(0);
  const archived = repository.list("owner")[0];
  expect(archived).toMatchObject({ status: "archived", archivedAt: "2026-09-05T16:00:00.000Z", completedAt: completed.completedAt, version: 4 });
  expect(archived.documents).toEqual(completed.documents); expect(archived.responses).toEqual(completed.responses);
  expect(archived.audit.filter(entry => entry.action === "approval_archived")).toHaveLength(1);
  expect(db.prepare("SELECT count(*) AS n FROM member_notifications").get()?.n).toBe(notificationsBefore);
  expect(repository.lifecycle(item.id, { action: "complete", expectedVersion: 2 }, "owner").status).toBe("archived");
  expect(() => repository.lifecycle(item.id, { action: "complete", expectedVersion: 100 }, "owner")).toThrow(/版本/);
});
it("uses Shanghai next-day boundaries across months, years and leap days", () => {
  expect(nextShanghaiMidnight(new Date("2026-12-31T15:59:59.999Z"))).toBe("2026-12-31T16:00:00.000Z");
  expect(nextShanghaiMidnight(new Date("2026-12-31T16:00:00.000Z"))).toBe("2027-01-01T16:00:00.000Z");
  expect(nextShanghaiMidnight(new Date("2028-02-28T17:00:00.000Z"))).toBe("2028-02-29T16:00:00.000Z");
  expect(() => nextShanghaiMidnight(new Date("bad"))).toThrow();
});
it("GET repository reads archive due rows and sort active before completed or archived history", () => {
  const item = create({ dueAt: "2020-01-01T00:00:00.000Z" }); repository.respond(item.id, { action: "approved", expectedVersion: 1 }, "reviewer"); repository.lifecycle(item.id, { action: "complete", expectedVersion: 2 }, "owner");
  const active = create({ dueAt: "2030-01-01T00:00:00.000Z" });
  expect(repository.list("owner").map(entry => entry.id)).toEqual([active.id, item.id]);
  vi.setSystemTime(new Date("2026-09-05T16:00:01.000Z"));
  expect(repository.list("owner", { status: "current" }).map(entry => entry.id)).toEqual([active.id]);
  expect(repository.list("owner", { status: "archived" }).map(entry => entry.id)).toEqual([item.id]);
  expect(repository.list("owner", { activityId: item.id })[0].status).toBe("archived");
  expect(repository.list("other", { activityId: item.id })).toEqual([]);
});
it("preserves legacy creation keys while adding an editable reimbursement subtype", () => {
  const item = create({}, "legacy");
  expect(item.approvalType).toBe("general");
  expect(String(db.prepare("SELECT input_json FROM workspace_activity WHERE id=?").get(item.id)?.input_json)).not.toContain("approvalType");
  expect(create({ approvalType: "general" }, "legacy").id).toBe(item.id);
  const edited = repository.edit(item.id, { ...input, approvalType: "reimbursement", expectedVersion: 1 }, "owner", "edit");
  expect(edited).toMatchObject({ approvalType: "reimbursement", version: 2 });
  expect(() => repository.create({ kind: "task", title: "bypass", approvalType: "reimbursement" }, "owner", "bad")).toThrow();
  const reimbursed = create({ approvalType: "reimbursement" });
  expect(reimbursed.approvalType).toBe("reimbursement");
  expect(db.prepare("SELECT message FROM member_notifications WHERE target_url=?").get(`/approvals?activity=${reimbursed.id}`)?.message).toContain("报销");
  const withdrawn = repository.lifecycle(edited.id, { action: "withdraw", expectedVersion: 2 }, "owner");
  expect(() => repository.edit(edited.id, { ...input, approvalType: "reimbursement", expectedVersion: 1 }, "owner", "edit")).toThrow(/不能再修改/);
  expect(create({}, "legacy").status).toBe(withdrawn.status);
});
it("rolls lifecycle and automatic archive changes back when their audit fails", () => {
  const item = create();
  db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON workspace_activity_audit BEGIN SELECT RAISE(ABORT,'audit failed'); END");
  expect(() => repository.lifecycle(item.id, { action: "withdraw", expectedVersion: 1 }, "owner")).toThrow("audit failed");
  expect(repository.list("owner")[0]).toMatchObject({ status: "active", withdrawnAt: null, version: 1 });
  db.exec("DROP TRIGGER fail_audit");
  repository.respond(item.id, { action: "approved", expectedVersion: 1 }, "reviewer"); repository.lifecycle(item.id, { action: "complete", expectedVersion: 2 }, "owner");
  db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON workspace_activity_audit BEGIN SELECT RAISE(ABORT,'audit failed'); END");
  expect(() => archiveDueApprovals(db, new Date("2026-09-05T16:00:00.000Z"))).toThrow("audit failed");
  expect(db.prepare("SELECT status,version,archived_at FROM workspace_activity WHERE id=?").get(item.id)).toMatchObject({ status: "completed", version: 3, archived_at: null });
});
it("enforces terminal states against old-release SQL while allowing only an exact archive transition", () => {
  const item = create(); repository.lifecycle(item.id, { action: "withdraw", expectedVersion: 1 }, "owner");
  const closedStatements = [
    ["UPDATE workspace_activity SET title='changed',version=version+1 WHERE id=?", item.id],
    ["UPDATE workspace_activity SET kind='task',status='active' WHERE id=?", item.id],
    ["DELETE FROM workspace_activity WHERE id=?", item.id],
    ["UPDATE workspace_activity_responses SET action='approved' WHERE activity_id=?", item.id],
    ["DELETE FROM workspace_activity_responses WHERE activity_id=?", item.id],
    ["INSERT INTO workspace_activity_responses(activity_id,member_id) VALUES(?,'other')", item.id],
    ["DELETE FROM workspace_activity_documents WHERE activity_id=?", item.id],
    ["UPDATE workspace_activity_documents SET original_name='changed' WHERE activity_id=?", item.id],
    ["INSERT INTO workspace_activity_documents(id,activity_id,original_name,media_type,document_kind,byte_length,content,uploaded_by,created_at,idempotency_key,input_json) VALUES ('extra',?,'extra.txt','text/plain','text',1,X'78','owner','2026-09-05','extra','{}')", item.id],
    ["INSERT INTO activity_project_documents(id,activity_id,project_document_id,added_by,created_at) VALUES('ref',?,'nonexistent','owner','2026-09-05')", item.id],
  ];
  for (const [sql, id] of closedStatements) expect(() => db.prepare(sql).run(id)).toThrow(/不能再修改/);
  const completed = create(); repository.respond(completed.id, { action: "approved", expectedVersion: 1 }, "reviewer"); repository.lifecycle(completed.id, { action: "complete", expectedVersion: 2 }, "owner");
  expect(() => db.prepare("UPDATE workspace_activity SET status='archived',archived_at='2026-09-05T16:00:00.000Z',updated_at=NULL,version=version+1 WHERE id=?").run(completed.id)).toThrow(/不能再修改/);
  expect(() => db.prepare("UPDATE workspace_activity SET status='archived',archived_at='2026-09-05T16:00:00.000Z',updated_at='2026-09-05T16:00:00.000Z',title='changed',version=version+1 WHERE id=?").run(completed.id)).toThrow(/不能再修改/);
  expect(() => db.prepare("UPDATE workspace_activity SET status='archived',archived_at='2026-09-05T15:59:59.000Z',updated_at='2026-09-05T15:59:59.000Z',version=version+1 WHERE id=?").run(completed.id)).toThrow(/不能再修改/);
  expect(archiveDueApprovals(db, new Date("2026-09-05T16:00:00.000Z"))).toBe(1);
});
it("lets the original applicant complete and immediately archive an approved request atomically", () => {
  const item = create(); repository.respond(item.id, { action: "approved", expectedVersion: 1 }, "reviewer");
  const archived = repository.lifecycle(item.id, { action: "complete", expectedVersion: 2, archiveNow: true }, "owner");
  expect(archived).toMatchObject({ status: "archived", completedAt: "2026-09-05T15:59:00.000Z", archivedAt: "2026-09-05T15:59:00.000Z", archiveAt: "2026-09-05T15:59:00.000Z", version: 3 });
  expect(archived.documents).toEqual(item.documents); expect(archived.responses[0].action).toBe("approved");
  expect(archived.audit.filter(entry => ["approval_completed", "approval_archived"].includes(entry.action)).map(entry => entry.action).sort()).toEqual(["approval_archived", "approval_completed"]);
  expect(repository.lifecycle(item.id, { action: "complete", expectedVersion: 2, archiveNow: true }, "owner")).toEqual(archived);
  expect(archiveDueApprovals(db, new Date("2026-09-05T16:00:00.000Z"))).toBe(0);
});
it("rejects immediate archive for withdrawal and stale competing completion", () => {
  const item = create();
  expect(() => repository.lifecycle(item.id, { action: "withdraw", expectedVersion: 1, archiveNow: true }, "owner")).toThrow();
  repository.respond(item.id, { action: "approved", expectedVersion: 1 }, "reviewer");
  repository.lifecycle(item.id, { action: "complete", expectedVersion: 2, archiveNow: true }, "owner");
  expect(() => repository.lifecycle(item.id, { action: "complete", expectedVersion: 1, archiveNow: true }, "owner")).toThrow(/版本/);
});
it("records an approval recipient view once without changing the approval version", () => {
  const item = create();
  expect(item.responses[0]).toMatchObject({ assignedAt: "2026-09-05T15:59:00.000Z", viewedAt: null });
  const viewed = repository.view(item.id, "reviewer");
  expect(viewed.responses[0].viewedAt).toBe("2026-09-05T15:59:00.000Z"); expect(viewed.version).toBe(1);
  expect(repository.view(item.id, "reviewer")).toEqual(viewed);
  expect(() => repository.view(item.id, "owner")).toThrow(/接收人/);
  expect(() => repository.view(item.id, "other")).toThrow(/接收人/);
  expect(() => repository.view("missing", "reviewer")).toThrow(/不存在/);
});
it("allows an authorized administrator to complete and immediately archive but not withdraw", () => {
  const item = create(); repository.respond(item.id, { action: "approved", expectedVersion: 1 }, "reviewer");
  expect(() => repository.lifecycle(item.id, { action: "withdraw", expectedVersion: 2 }, "admin", { canAdmin: true })).toThrow(/申请人|管理员/);
  const archived = repository.lifecycle(item.id, { action: "complete", expectedVersion: 2, archiveNow: true }, "admin", { canAdmin: true });
  expect(archived.status).toBe("archived"); expect(archived.audit.some(entry => entry.actorId === "admin" && entry.action === "approval_archived")).toBe(true);
});
