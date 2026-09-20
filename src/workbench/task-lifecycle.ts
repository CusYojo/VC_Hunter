import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { ApprovalLifecycleError } from "./approval-lifecycle";
import { activityNotificationUrl } from "./notifications";

export const taskLifecycleSchema = z.object({
  action: z.enum(["archive", "delete"]),
  expectedVersion: z.number().int().positive(),
}).strict();

function successfulRetry(db: DatabaseSync, row: Record<string, unknown>, action: "archive" | "delete", expectedVersion: number, actorId: string) {
  if (action === "archive" && (row.status !== "archived" || row.deleted_at)) return false;
  if (action === "delete" && !row.deleted_at) return false;
  const audit = db.prepare("SELECT note FROM workspace_activity_audit WHERE activity_id=? AND actor_id=? AND action=? ORDER BY rowid DESC LIMIT 1")
    .get(String(row.id), actorId, action === "archive" ? "task_archived" : "task_deleted") as { note?: string } | undefined;
  if (!audit) return false;
  const saved = JSON.parse(String(audit.note)) as { expectedVersion?: number };
  return saved.expectedVersion === expectedVersion;
}

export function transitionTask(db: DatabaseSync, id: string, raw: unknown, actorId: string, activeMemberIds: readonly string[], now = new Date(), options: { canAdmin?: boolean } = {}) {
  const input = taskLifecycleSchema.parse(raw);
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT * FROM workspace_activity WHERE id=?").get(id) as Record<string, unknown> | undefined;
    if (!row) throw new ApprovalLifecycleError(404, "NOT_FOUND", "待办不存在。");
    if (row.kind !== "task") throw new ApprovalLifecycleError(400, "INVALID_OPERATION", "只有待办可以直接归档或删除。");
    if (!activeMemberIds.includes(actorId) || (row.created_by !== actorId && !options.canAdmin)) throw new ApprovalLifecycleError(403, "FORBIDDEN", "只有待办发起人或组织管理员可以归档或删除。");
    if (successfulRetry(db, row, input.action, input.expectedVersion, actorId)) { db.exec("COMMIT"); return row; }
    if (Number(row.version) !== input.expectedVersion) throw new ApprovalLifecycleError(409, "CONFLICT", "待办版本已更新，请刷新后重试。");
    if (row.deleted_at) throw new ApprovalLifecycleError(409, "ACTIVITY_CLOSED", "该待办已删除。");
    if (input.action === "archive" && row.status !== "active") throw new ApprovalLifecycleError(409, "ACTIVITY_CLOSED", "该待办已归档。");
    if (input.action === "delete" && !["active", "archived"].includes(String(row.status ?? "active"))) throw new ApprovalLifecycleError(409, "ACTIVITY_CLOSED", "该待办当前状态不能删除。");
    const at = now.toISOString();
    const deleted = input.action === "delete";
    const updated = db.prepare(`UPDATE workspace_activity SET status='archived',archived_at=COALESCE(archived_at,?),deleted_at=?,updated_at=?,version=version+1
      WHERE id=? AND version=? AND deleted_at IS NULL`).run(at, deleted ? at : null, at, id, input.expectedVersion);
    if (Number(updated.changes) !== 1) throw new ApprovalLifecycleError(409, "CONFLICT", "待办版本已更新，请刷新后重试。");
    db.prepare("INSERT INTO workspace_activity_audit(id,activity_id,actor_id,action,note,created_at) VALUES(?,?,?,?,?,?)")
      .run(randomUUID(), id, actorId, deleted ? "task_deleted" : "task_archived", JSON.stringify({ expectedVersion: input.expectedVersion, version: input.expectedVersion + 1 }), at);
    db.prepare("UPDATE member_notifications SET read_at=? WHERE target_url=? AND read_at IS NULL").run(at, activityNotificationUrl("task", id));
    const result = db.prepare("SELECT * FROM workspace_activity WHERE id=?").get(id)!;
    db.exec("COMMIT");
    return result;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
