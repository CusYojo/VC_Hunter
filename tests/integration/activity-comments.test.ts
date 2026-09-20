import { afterEach, beforeEach, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import { WorkspaceActivityRepository } from "@/repositories/workspace-activity";
import { ActivityCommentsRepository } from "@/repositories/activity-comments";
import { activityCommentsMigration } from "@/workbench/activity-comments-migration";
import { uploadProjectDocument } from "@/workbench/documents";
let db: DatabaseSync; let activities: WorkspaceActivityRepository; let comments: ActivityCommentsRepository; let root: string;
const input = { kind: "approval", title: "批复事项", participantIds: ["bob"], dueAt: "2026-10-01T10:00:00.000Z" };
const file = { name: "补充说明.txt", mimeType: "text/plain", bytes: Buffer.from("原件补充内容") };
beforeEach(() => { db = createDatabase(":memory:"); initializeDatabase(db); seedDemoData(db); if (!db.prepare("SELECT name FROM sqlite_master WHERE name='activity_comments'").get()) db.exec(activityCommentsMigration.upSql); root = mkdtempSync(join(tmpdir(), "activity-comments-")); activities = new WorkspaceActivityRepository(db, ["alice", "bob", "eve"]); comments = new ActivityCommentsRepository(db, ["alice", "bob", "eve"], { storageRoot: root }); });
afterEach(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
it("allows repeated author/participant replies after approval without changing formal decisions or version", () => {
  const activity = activities.create(input, "alice", "activity");
  const first = comments.create(activity.id, { body: "请核对样机进展" }, "alice", "first");
  const reply = comments.create(activity.id, { body: "已查看，还需要测试记录", parentId: first.id }, "bob", "reply");
  activities.respond(activity.id, { action: "approved", note: "批准", expectedVersion: 1 }, "bob");
  const followup = comments.create(activity.id, { body: "审批后继续补充", parentId: reply.id }, "alice", "followup", [file]);
  expect(comments.list(activity.id, "bob").items.map(item => item.id)).toEqual([first.id, reply.id, followup.id]);
  expect(activities.list("alice")[0]).toMatchObject({ version: 2, responses: [expect.objectContaining({ action: "approved", note: "批准" })] });
  expect(activities.list("alice")[0].documents).toHaveLength(0);
  expect(followup.documents).toHaveLength(1);
});
it("privately attaches local bytes and existing project files atomically, including file-only replies", async () => {
  const source = await uploadProjectDocument(db, { projectId: "project-qiongxin", expectedVersion: Number(db.prepare("SELECT version FROM projects WHERE id='project-qiongxin'").get()?.version), name: "项目原件.txt", mimeType: "text/plain", bytes: Buffer.from("来自项目库原件"), externalPolicy: "local_only", actorId: "alice", idempotencyKey: "source", storageRoot: root });
  const activity = activities.create(input, "alice", "activity");
  const saved = comments.create(activity.id, { projectDocumentIds: [source.id, source.id] }, "bob", "files", [file]);
  expect(saved.body).toBe(""); expect(saved.documents).toHaveLength(2);
  for (const document of saved.documents) {
    expect(comments.readDocument(activity.id, saved.id, document.id, "alice").bytes.length).toBeGreaterThan(0);
    expect(() => comments.readDocument(activity.id, saved.id, document.id, "eve")).toThrow(/不存在/);
    expect(() => comments.readDocument(activity.id, "another-comment", document.id, "alice")).toThrow(/不存在/);
  }
  expect(saved.documents.find(d => d.source === "project")).toMatchObject({ projectDocumentId: source.id, originalName: "项目原件.txt" });
  expect(Buffer.from(comments.readDocument(activity.id, saved.id, saved.documents.find(d => d.source === "project")!.id, "bob").bytes).toString()).toBe("来自项目库原件");
});
it("rejects outsiders, removed members and cross-activity reply parents", () => {
  const activity = activities.create(input, "alice", "activity");
  const other = activities.create(input, "alice", "other");
  const first = comments.create(other.id, { body: "另一个事项" }, "bob", "first");
  expect(() => comments.create(activity.id, { body: "越权" }, "eve", "bad")).toThrow(/不存在/);
  expect(() => comments.list(activity.id, "eve")).toThrow(/不存在/);
  expect(() => new ActivityCommentsRepository(db, ["bob"]).list(activity.id, "alice")).toThrow(/不存在/);
  expect(() => comments.create(activity.id, { body: "跨事项", parentId: first.id }, "alice", "cross")).toThrow(/回复/);
  expect(comments.list(activity.id, "alice").items).toHaveLength(0);
});
it("deduplicates retries by actor and content and rejects changed payloads", () => {
  const activity = activities.create(input, "alice", "activity");
  const first = comments.create(activity.id, { body: "同一批注" }, "alice", "key", [file]);
  expect(comments.create(activity.id, { body: "同一批注", projectDocumentIds: [] }, "alice", "key", [file]).id).toBe(first.id);
  expect(() => comments.create(activity.id, { body: "改过内容" }, "alice", "key", [file])).toThrow(/幂等/);
  expect(() => comments.create(activity.id, { body: "同一批注" }, "alice", "key", [{ ...file, bytes: Buffer.from("不同字节") }])).toThrow(/幂等/);
  expect(comments.create(activity.id, { body: "同一批注" }, "bob", "key").id).not.toBe(first.id);
  expect(comments.list(activity.id, "alice").items).toHaveLength(2);
});
it("rejects empty, forged and invalid attachments and rolls back storage errors", () => {
  const activity = activities.create(input, "alice", "activity");
  expect(() => comments.create(activity.id, {}, "alice", "empty")).toThrow();
  expect(() => comments.create(activity.id, { body: "x", actorId: "bob" }, "alice", "forged")).toThrow();
  expect(() => comments.create(activity.id, { body: "x" }, "alice", " ")).toThrow();
  expect(() => comments.create(activity.id, { projectDocumentIds: ["missing"] }, "alice", "missing")).toThrow();
  expect(() => comments.create(activity.id, { body: "x" }, "alice", "bad-file", [{ ...file, name: "bad.exe" }])).toThrow();
  db.exec("CREATE TRIGGER fail_comment_files BEFORE INSERT ON activity_comment_documents BEGIN SELECT RAISE(ABORT,'storage-failure'); END");
  expect(() => comments.create(activity.id, { body: "x" }, "alice", "rollback", [file])).toThrow();
  expect(comments.list(activity.id, "bob").items).toHaveLength(0);
});
it("paginates every discussion in stable creation order without losing equal-time entries", () => {
  const activity = activities.create({ ...input, kind: "task" }, "alice", "activity");
  for (let index = 0; index < 102; index++) comments.create(activity.id, { body: `第${index}条` }, "alice", `key-${index}`);
  const first = comments.list(activity.id, "bob");
  expect(first.items).toHaveLength(100); expect(first.hasMore).toBe(true);
  const rest = comments.list(activity.id, "bob", first.nextCursor!);
  expect(rest.items.map(item => item.body)).toEqual(["第100条", "第101条"]); expect(rest.hasMore).toBe(false);
  expect(() => comments.list(activity.id, "bob", -1)).toThrow();
});
