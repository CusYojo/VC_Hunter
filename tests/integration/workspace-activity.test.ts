import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, initializeDatabase } from "@/db/client";
import { WorkspaceActivityRepository } from "@/repositories/workspace-activity";
import type { DatabaseSync } from "node:sqlite";

let database: DatabaseSync;
let repository: WorkspaceActivityRepository;
beforeEach(() => { database = createDatabase(":memory:"); initializeDatabase(database); repository = new WorkspaceActivityRepository(database, ["alice", "bob"]); });
afterEach(() => database.close());
const input = { kind: "task", title: "核对财务资料", description: "检查来源", participantIds: ["bob"], dueAt: "2026-09-05T02:00:00.000Z", location: "", projectId: null };
describe("persistent personal work and approval inbox", () => {
  it("persists assignments and includes only actor-related records", () => {
    const record = repository.create(input, "alice", "create-1");
    expect(repository.list("bob")).toHaveLength(1);
    expect(repository.list("unrelated")).toEqual([]);
    expect(repository.list("alice")[0].id).toBe(record.id);
    expect(new WorkspaceActivityRepository(database, ["alice", "bob"]).list("bob")[0].title).toBe(input.title);
  });
  it("deduplicates retries and rejects reused keys with changed payloads", () => {
    const record = repository.create(input, "alice", "create-1");
    expect(repository.create(input, "alice", "create-1").id).toBe(record.id);
    expect(() => repository.create({ ...input, title: "changed" }, "alice", "create-1")).toThrow(/幂等键/);
  });
  it("allows only the recipient to respond and preserves change requests", () => {
    const record = repository.create(input, "alice", "create-1");
    expect(() => repository.respond(record.id, { action: "accepted", note: "", expectedVersion: 1 }, "alice")).toThrow(/权限/);
    const updated = repository.respond(record.id, { action: "change_requested", note: "需要延期一天", expectedVersion: 1 }, "bob");
    expect(updated.responses[0].note).toBe("需要延期一天");
    expect(updated.version).toBe(2);
    expect(() => repository.respond(record.id, { action: "accepted", note: "", expectedVersion: 1 }, "bob")).toThrow(/版本冲突/);
  });
  it("requires an independent reviewer for approval and prevents self approval", () => {
    expect(() => repository.create({ ...input, kind: "approval", participantIds: ["alice"] }, "alice", "bad")).toThrow();
    const record = repository.create({ ...input, kind: "approval" }, "alice", "approval-1");
    expect(repository.respond(record.id, { action: "approved", note: "资料齐全", expectedVersion: 1 }, "bob").responses[0].action).toBe("approved");
    expect(() => repository.respond(record.id, { action: "approved", note: "", expectedVersion: 2 }, "alice")).toThrow(/权限/);
  });
  it("validates dates, linked projects, participants and action-kind combinations", () => {
    expect(() => repository.create({ ...input, participantIds: ["unknown"] }, "alice", "a")).toThrow();
    expect(() => repository.create({ ...input, projectId: "missing" }, "alice", "b")).toThrow();
    expect(() => repository.create({ ...input, dueAt: "bad" }, "alice", "c")).toThrow();
    const record = repository.create(input, "alice", "d");
    expect(() => repository.respond(record.id, { action: "approved", note: "", expectedVersion: 1 }, "bob")).toThrow();
    expect(() => repository.respond(record.id, { action: "change_requested", note: "", expectedVersion: 1 }, "bob")).toThrow();
  });
});

it("returns plain nested objects that Next.js can pass to the approvals client", () => {
  const record = repository.create({ ...input, kind: "approval" }, "alice", "rsc-safe");
  const updated = repository.uploadDocument(record.id, { expectedVersion: 1, name: "说明.txt", mimeType: "text/plain", bytes: Buffer.from("审阅说明") }, "alice", "rsc-upload");
  for (const nested of [...updated.responses, ...updated.audit, ...(updated.documents ?? [])]) {
    expect(Object.getPrototypeOf(nested)).toBe(Object.prototype);
  }
});
