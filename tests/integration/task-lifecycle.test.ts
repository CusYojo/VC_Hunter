import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { WorkspaceActivityRepository } from "@/repositories/workspace-activity";

describe("task archive and delete lifecycle", () => {
  let database: DatabaseSync;
  let repository: WorkspaceActivityRepository;

  beforeEach(() => {
    database = createDatabase(":memory:");
    initializeDatabase(database);
    repository = new WorkspaceActivityRepository(database, ["alice", "bob", "admin"]);
  });
  afterEach(() => database.close());

  function create(key: string) {
    return repository.create({ kind: "task", title: `核对项目资料 ${key}`, participantIds: ["bob"] }, "alice", key);
  }

  it("lets the creator archive a task immediately and keeps the transition repeat-safe", () => {
    const task = create("archive-task");
    const archived = repository.lifecycle(task.id, { action: "archive", expectedVersion: 1 }, "alice");
    expect(archived).toMatchObject({ status: "archived", archivedAt: expect.any(String), deletedAt: null, version: 2 });
    expect(repository.lifecycle(task.id, { action: "archive", expectedVersion: 1 }, "alice")).toEqual(archived);
    expect(repository.list("alice", { status: "current" })).toEqual([]);
    expect(repository.list("bob", { status: "archived" })[0].id).toBe(task.id);
  });

  it("soft-deletes a task while retaining its audit trail and hiding it from every list", () => {
    const task = create("delete-task");
    const deleted = repository.lifecycle(task.id, { action: "delete", expectedVersion: 1 }, "alice");
    expect(deleted).toMatchObject({ status: "archived", deletedAt: expect.any(String), version: 2 });
    expect(repository.lifecycle(task.id, { action: "delete", expectedVersion: 1 }, "alice")).toEqual(deleted);
    expect(repository.list("alice", { status: "all" })).toEqual([]);
    expect(repository.list("bob", { status: "archived" })).toEqual([]);
    expect(database.prepare("SELECT action FROM workspace_activity_audit WHERE activity_id=? ORDER BY rowid DESC LIMIT 1").get(task.id)).toEqual({ action: "task_deleted" });
  });

  it("rejects recipients, stale writers and non-task lifecycle shortcuts", () => {
    const task = create("protected-task");
    expect(() => repository.lifecycle(task.id, { action: "archive", expectedVersion: 1 }, "bob")).toThrow(/发起人|权限/);
    repository.respond(task.id, { action: "accepted", expectedVersion: 1 }, "bob");
    expect(() => repository.lifecycle(task.id, { action: "delete", expectedVersion: 1 }, "alice")).toThrow(/版本/);
    const meeting = repository.create({ kind: "meeting", title: "项目会议", participantIds: ["bob"] }, "alice", "meeting");
    expect(() => repository.lifecycle(meeting.id, { action: "archive", expectedVersion: 1 }, "alice")).toThrow(/待办/);
    const approval = repository.create({ kind: "approval", title: "项目审批", participantIds: ["bob"] }, "alice", "approval");
    expect(() => repository.lifecycle(approval.id, { action: "delete", expectedVersion: 1 }, "alice")).toThrow(/待办/);
  });
});
