import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { archiveDueApprovals } from "@/workbench/approval-lifecycle";
import { readOfficeWorkspace } from "@/organization/office-read-model";
import { WorkspaceActivityRepository } from "@/repositories/workspace-activity";
import { ActivityCommentsRepository } from "@/repositories/activity-comments";
const members = ["alice", "bob"];
const directory = { departments: [], members: members.map(id => ({ id, name: id, title: "成员", departmentId: null, active: true, isPlaceholder: false, version: 1 })) };
const actor = { tenantId: "org", accountId: "alice", memberId: "alice", canManage: true };
let db: DatabaseSync;
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-05T15:59:00.000Z")); db = createDatabase(":memory:"); initializeDatabase(db); });
afterEach(() => { db.close(); vi.useRealTimers(); });
const read = () => readOfficeWorkspace(db, actor, directory);
it.each(["withdrawn", "completed", "archived"])("removes %s approvals from every office projection while preserving comment history", status => {
  const repository = new WorkspaceActivityRepository(db, members);
  const activity = repository.create({ kind: "approval", title: "出差报销", participantIds: ["bob"] }, "alice", "approval");
  const comments = new ActivityCommentsRepository(db, members);
  comments.create(activity.id, { body: "收据已核对" }, "bob", "comment");
  expect(read().activity?.queues.map(item => item.kind).sort()).toEqual(["approval", "comment"]);
  expect(read().activity?.todos).toHaveLength(1);
  expect(read().members.flatMap(item => item.tasks)).toHaveLength(2);
  if (status === "withdrawn") repository.lifecycle(activity.id, { action: "withdraw", expectedVersion: 1 }, "alice");
  else {
    repository.respond(activity.id, { action: "approved", expectedVersion: 1 }, "bob");
    repository.lifecycle(activity.id, { action: "complete", expectedVersion: 2 }, "alice");
    if (status === "archived") archiveDueApprovals(db, new Date("2026-09-05T16:00:00.000Z"));
  }
  expect(read().activity).toMatchObject({ todos: [], queues: [], meetings: [] });
  expect(read().members.flatMap(item => item.tasks)).toEqual([]);
  expect(comments.list(activity.id, "alice").items[0].body).toBe("收据已核对");
});
it("keeps reimbursement approvals queued and does not hide other kinds of activity", () => {
  const repository = new WorkspaceActivityRepository(db, members);
  const expense = repository.create({ kind: "approval", approvalType: "reimbursement", title: "交通费报销", participantIds: ["bob"] }, "alice", "expense");
  const general = repository.create({ kind: "approval", title: "普通审批", participantIds: ["bob"] }, "alice", "general");
  const meeting = repository.create({ kind: "meeting", title: "仍在进行的会议", participantIds: ["bob"], dueAt: "2026-01-01T00:00:00Z" }, "alice", "meeting");
  repository.respond(general.id, { action: "approved", expectedVersion: 1 }, "bob");
  repository.lifecycle(general.id, { action: "complete", expectedVersion: 2 }, "alice");
  expect(read().activity?.queues).toEqual([expect.objectContaining({ fromMemberId: "alice", toMemberId: "bob", kind: "approval", targetUrl: `/approvals?activity=${expense.id}` })]);
  expect(read().activity?.todos.map(item => item.id).sort()).toEqual([expense.id, meeting.id].sort());
  expect(read().activity?.meetings).toEqual([expect.objectContaining({ id: meeting.id })]);
});
it("keeps an approved active approval as one applicant completion todo without approval footsteps", () => {
  const repository = new WorkspaceActivityRepository(db, members);
  const approval = repository.create({ kind: "approval", title: "交通费报销", approvalType: "reimbursement", participantIds: ["bob"] }, "alice", "awaiting-completion");
  repository.respond(approval.id, { action: "approved", expectedVersion: 1 }, "bob");
  const workspace = read();
  expect(workspace.activity?.todos).toEqual([expect.objectContaining({ id: approval.id, memberIds: ["alice"], title: "审批已通过 · 待申请方完成：交通费报销" })]);
  expect(workspace.activity?.queues).toEqual([]);
  expect(workspace.members.find(member => member.id === "alice")?.tasks).toEqual([expect.objectContaining({ id: approval.id, title: "审批已通过 · 待申请方完成：交通费报销" })]);
  expect(workspace.members.find(member => member.id === "bob")?.tasks).toEqual([]);
  repository.lifecycle(approval.id, { action: "complete", expectedVersion: 2 }, "alice");
  expect(read().activity?.todos).toEqual([]);
  expect(read().members.flatMap(member => member.tasks)).toEqual([]);
});
