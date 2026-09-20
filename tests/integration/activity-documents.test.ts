import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, initializeDatabase } from "@/db/client";
import { WorkspaceActivityRepository } from "@/repositories/workspace-activity";
import type { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let database: DatabaseSync;
let repository: WorkspaceActivityRepository;
beforeEach(() => { database = createDatabase(":memory:"); initializeDatabase(database); repository = new WorkspaceActivityRepository(database, ["alice", "bob", "eve"]); });
afterEach(() => database.close());
const input = { kind: "approval", title: "投资审批", participantIds: ["bob"], dueAt: "2026-09-05T02:00:00.000Z" };
const upload = { expectedVersion: 1, name: "审批材料.txt", mimeType: "text/plain", bytes: Buffer.from("内部投资资料") };

describe("approval documents", () => {
  it("persists bytes and metadata, increments version and records an audit event", () => {
    const activity = repository.create(input, "alice", "create");
    const updated = repository.uploadDocument(activity.id, upload, "alice", "upload");
    expect(updated.version).toBe(2);
    expect(updated.documents).toEqual([expect.objectContaining({ originalName: upload.name, kind: "text", byteLength: upload.bytes.length })]);
    expect(updated.audit).toContainEqual(expect.objectContaining({ action: "document_uploaded", actorId: "alice", note: upload.name }));
    const reopened = new WorkspaceActivityRepository(database, ["alice", "bob"]);
    const document = reopened.readDocument(activity.id, updated.documents![0].id, "bob");
    expect(Buffer.from(document.bytes).toString()).toBe("内部投资资料");
    expect(reopened.list("alice")[0].documents).toEqual(updated.documents);
    expect(() => repository.respond(activity.id, { action: "approved", expectedVersion: 1 }, "bob")).toThrow(/版本冲突/);
  });
  it("only lets the author upload to pending approvals", () => {
    const approval = repository.create(input, "alice", "create");
    for (const actor of ["bob", "eve"]) expect(() => repository.uploadDocument(approval.id, upload, actor, "upload")).toThrow(/权限/);
    const task = repository.create({ ...input, kind: "task" }, "alice", "task");
    expect(repository.uploadDocument(task.id, upload, "alice", "upload").documents).toHaveLength(1);
    repository.respond(approval.id, { action: "returned", note: "补充资料", expectedVersion: 1 }, "bob");
    expect(() => repository.uploadDocument(approval.id, { ...upload, expectedVersion: 2 }, "alice", "upload")).toThrow(/已处理/);
  });
  it("hides bytes from unrelated actors and rejects document/activity mismatches", () => {
    const first = repository.create(input, "alice", "first");
    const second = repository.create(input, "alice", "second");
    const updated = repository.uploadDocument(first.id, upload, "alice", "upload");
    const id = updated.documents![0].id;
    expect(() => repository.readDocument(first.id, id, "eve")).toThrow(/不存在/);
    expect(() => repository.readDocument(second.id, id, "bob")).toThrow(/不存在/);
    expect(repository.readDocument(first.id, id, "alice").originalName).toBe(upload.name);
  });
  it("deduplicates identical retries and rejects changed payloads and stale versions", () => {
    const activity = repository.create(input, "alice", "create");
    const first = repository.uploadDocument(activity.id, upload, "alice", "upload");
    expect(repository.uploadDocument(activity.id, upload, "alice", "upload")).toEqual(first);
    expect(() => repository.uploadDocument(activity.id, { ...upload, name: "other.txt" }, "alice", "upload")).toThrow(/幂等键/);
    expect(() => repository.uploadDocument(activity.id, upload, "alice", "second")).toThrow(/版本冲突/);
    expect(repository.list("alice")[0].documents).toHaveLength(1);
    repository.respond(activity.id, { action: "approved", expectedVersion: 2 }, "bob");
    const replay = repository.uploadDocument(activity.id, upload, "alice", "upload");
    expect(replay.version).toBe(3);
    expect(replay.responses[0].action).toBe("approved");
    expect(replay.documents).toHaveLength(1);
    expect(replay.audit.filter((event) => event.action === "document_uploaded")).toHaveLength(1);
  });
  it("survives closing and reopening the database without repeating migrations", () => {
    const directory = mkdtempSync(join(tmpdir(), "approval-documents-"));
    const path = join(directory, "app.sqlite");
    let persistent = createDatabase(path);
    try {
      initializeDatabase(persistent);
      const first = new WorkspaceActivityRepository(persistent, ["alice", "bob"]);
      const approval = first.create(input, "alice", "create");
      const saved = first.uploadDocument(approval.id, upload, "alice", "upload");
      persistent.close();
      persistent = createDatabase(path);
      initializeDatabase(persistent);
      const restored = new WorkspaceActivityRepository(persistent, ["alice", "bob"]);
      expect(restored.list("bob")[0].documents).toEqual(saved.documents);
      expect(Buffer.from(restored.readDocument(approval.id, saved.documents![0].id, "bob").bytes)).toEqual(upload.bytes);
    } finally { persistent.close(); rmSync(directory, { recursive: true, force: true }); }
  });
  it("validates filename, type, bytes, version and key without changing the approval", () => {
    const activity = repository.create(input, "alice", "create");
    for (const invalid of [{ bytes: Buffer.alloc(0) }, { bytes: Buffer.alloc(20 * 1024 * 1024 + 1) }, { name: "bad.exe" }, { mimeType: "text/html" }, { name: "../secret.txt" }, { name: "bad\n.txt" }, { expectedVersion: 0 }]) {
      expect(() => repository.uploadDocument(activity.id, { ...upload, ...invalid }, "alice", "upload")).toThrow();
    }
    expect(() => repository.uploadDocument(activity.id, upload, "alice", "")).toThrow();
    expect(repository.list("alice")[0].version).toBe(1);
  });
});
