import { afterEach, beforeEach, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import { WorkspaceActivityRepository } from "@/repositories/workspace-activity";
import { activityProjectDocumentsMigration } from "@/workbench/activity-project-documents-migration";
import { uploadProjectDocument } from "@/workbench/documents";
let db: DatabaseSync; let repository: WorkspaceActivityRepository; let root: string;
const input = { kind: "task", title: "协作事项", participantIds: ["bob"], dueAt: "2026-10-01T10:00:00.000Z" };
const file = { name: "事项资料.txt", mimeType: "text/plain", bytes: Buffer.from("事项的本地附件") };
beforeEach(() => { db = createDatabase(":memory:"); initializeDatabase(db); seedDemoData(db); if (!db.prepare("SELECT name FROM sqlite_master WHERE name='activity_project_documents'").get()) db.exec(activityProjectDocumentsMigration.upSql); root = mkdtempSync(join(tmpdir(), "activity-attachments-")); repository = new WorkspaceActivityRepository(db, ["alice", "bob", "eve"], { storageRoot: root }); });
afterEach(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
async function projectFile() {
  const version = Number(db.prepare("SELECT version FROM projects WHERE id='project-qiongxin'").get()?.version);
  return uploadProjectDocument(db, { projectId: "project-qiongxin", expectedVersion: version, name: "原始项目材料.txt", mimeType: "text/plain", bytes: Buffer.from("项目原始资料尚未解析"), externalPolicy: "local_only", actorId: "alice", idempotencyKey: crypto.randomUUID(), storageRoot: root });
}
it.each(["task", "meeting", "trip", "approval"])("atomically creates %s with uploads and deduplicated project references", async kind => {
  const original = await projectFile();
  const activity = repository.create({ ...input, kind, projectDocumentIds: [original.id, original.id] }, "alice", "new", [file]);
  expect(activity.documents).toHaveLength(2); expect(activity.version).toBe(1);
  const ref = activity.documents!.find(item => item.source === "project")!;
  expect(ref).toMatchObject({ projectId: "project-qiongxin", projectDocumentId: original.id, originalName: "原始项目材料.txt" });
  expect(Buffer.from(repository.readDocument(activity.id, ref.id, "bob").bytes).toString()).toBe("项目原始资料尚未解析");
  expect(() => repository.readDocument(activity.id, ref.id, "eve")).toThrow(/不存在/);
  expect(repository.create({ ...input, kind, projectDocumentIds: [original.id] }, "alice", "new", [file]).id).toBe(activity.id);
  expect(() => repository.create({ ...input, kind, projectDocumentIds: [original.id] }, "alice", "new", [{ ...file, bytes: Buffer.from("changed") }])).toThrow(/幂等/);
});
it("rejects invalid attachments and rolls back an audit failure without creating half an activity", () => {
  expect(() => repository.create({ ...input, projectDocumentIds: ["missing"] }, "alice", "bad", [file])).toThrow(/关联资料/);
  expect(() => repository.create(input, "alice", "bad", [file, { ...file, name: "bad.exe" }])).toThrow();
  expect(() => repository.create(input, "alice", "bad", Array.from({ length: 11 }, () => file))).toThrow();
  expect(() => repository.create(input, "alice", "bad", [{ ...file, bytes: Buffer.alloc(11 * 1024 * 1024, 1) }, { ...file, bytes: Buffer.alloc(11 * 1024 * 1024, 1) }])).toThrow();
  db.exec("CREATE TRIGGER fail_activity_audit BEFORE INSERT ON workspace_activity_audit BEGIN SELECT RAISE(ABORT,'private-storage-failure'); END");
  expect(() => repository.create(input, "alice", "audit", [file])).toThrow();
  expect(db.prepare("SELECT count(*) n FROM workspace_activity").get()?.n).toBe(0);
  expect(db.prepare("SELECT count(*) n FROM workspace_activity_documents").get()?.n).toBe(0);
});
it("preserves old attachment-free JSON idempotency and limits supplementary changes to the author", async () => {
  const activity = repository.create(input, "alice", "old");
  const stored = JSON.parse(String(db.prepare("SELECT input_json FROM workspace_activity WHERE id=?").get(activity.id)?.input_json));
  expect(stored).not.toHaveProperty("projectDocumentIds");
  expect(repository.create({ ...input, projectDocumentIds: [] }, "alice", "old").id).toBe(activity.id);
  const original = await projectFile();
  expect(() => repository.referenceDocuments(activity.id, { expectedVersion: 1, projectDocumentIds: [original.id] }, "bob", "ref")).toThrow(/权限/);
  const updated = repository.referenceDocuments(activity.id, { expectedVersion: 1, projectDocumentIds: [original.id] }, "alice", "ref");
  expect(updated.version).toBe(2); expect(updated.documents).toHaveLength(1);
  expect(repository.referenceDocuments(activity.id, { expectedVersion: 1, projectDocumentIds: [original.id] }, "alice", "ref").version).toBe(2);
  expect(() => repository.uploadDocument(activity.id, { ...file, expectedVersion: 1 }, "alice", "stale")).toThrow(/版本冲突/);
  repository.respond(activity.id, { action: "done", expectedVersion: 2 }, "bob");
  expect(() => repository.uploadDocument(activity.id, { ...file, expectedVersion: 3 }, "alice", "late")).toThrow(/已处理/);
  expect(() => repository.referenceDocuments(activity.id, { expectedVersion: 3, projectDocumentIds: [original.id] }, "alice", "late")).toThrow(/已处理/);
});
