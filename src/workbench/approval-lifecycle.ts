import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { activityNotificationUrl, insertNotifications } from "./notifications";

export class ApprovalLifecycleError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export const activityLifecycleSchema = z.object({
  action: z.enum(["withdraw", "complete"]),
  expectedVersion: z.number().int().positive(),
  archiveNow: z.boolean().default(false),
}).strict().refine(input => input.action === "complete" || !input.archiveNow, { message: "只有完成审批时可以选择立即归档。" });
export function assertActivityActive(row: Record<string, unknown>) {
  if ((row.status ?? "active") !== "active") throw new ApprovalLifecycleError(409, "ACTIVITY_CLOSED", "该审批已撤回、完成或归档，不能再修改。");
}
export function nextShanghaiMidnight(now: Date): string {
  const time = now.getTime(), offset = 8 * 60 * 60 * 1000, day = 24 * 60 * 60 * 1000;
  if (!Number.isFinite(time)) throw new RangeError("无效归档时间。");
  return new Date((Math.floor((time + offset) / day) + 1) * day - offset).toISOString();
}

/** Called outside other transactions by both request reads and the background worker. */
export function archiveDueApprovals(db: DatabaseSync, now = new Date()): number {
  const at = now.toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const rows = db.prepare("SELECT id FROM workspace_activity WHERE kind='approval' AND status='completed' AND archive_at<=? ORDER BY archive_at,id").all(at);
    for (const row of rows) {
      db.prepare("UPDATE workspace_activity SET status='archived',archived_at=?,updated_at=?,version=version+1 WHERE id=? AND status='completed'").run(at, at, String(row.id));
      db.prepare("INSERT INTO workspace_activity_audit(id,activity_id,actor_id,action,note,created_at) VALUES(?,?,?,?,?,?)").run(randomUUID(), String(row.id), "system", "approval_archived", "按上海时间次日零点自动归档", at);
    }
    db.exec("COMMIT"); return rows.length;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
function successfulRetry(db: DatabaseSync, row: Record<string, unknown>, action: "withdraw" | "complete", version: number, actorId: string, archiveNow: boolean) {
  const desired = action === "withdraw" ? row.status === "withdrawn" : archiveNow ? row.status === "archived" : row.status === "completed" || row.status === "archived";
  if (!desired) return false;
  const audit = db.prepare("SELECT note FROM workspace_activity_audit WHERE activity_id=? AND actor_id=? AND action=? ORDER BY rowid DESC LIMIT 1").get(String(row.id), actorId, action === "withdraw" ? "approval_withdrawn" : "approval_completed");
  if (!audit) return false;
  const saved = JSON.parse(String(audit.note)) as { expectedVersion?: number; archiveNow?: boolean };
  return saved.expectedVersion === version && (action !== "complete" || Boolean(saved.archiveNow) === archiveNow);
}

export function transitionApproval(db: DatabaseSync, id: string, raw: unknown, actorId: string, activeMemberIds: readonly string[], now = new Date(), options: { canAdmin?: boolean } = {}): Record<string, unknown> {
  const input = activityLifecycleSchema.parse(raw);
  archiveDueApprovals(db, now);
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT * FROM workspace_activity WHERE id=?").get(id);
    if (!row) throw new ApprovalLifecycleError(404, "NOT_FOUND", "审批不存在。");
    const adminImmediateArchive = Boolean(options.canAdmin && input.action === "complete" && input.archiveNow);
    if ((row.created_by !== actorId && !adminImmediateArchive) || !activeMemberIds.includes(actorId)) throw new ApprovalLifecycleError(403, "FORBIDDEN", "只有有效的原申请人或授权管理员可以完成归档。");
    if (row.kind !== "approval") throw new ApprovalLifecycleError(400, "INVALID_OPERATION", "只有审批可以执行撤回或完成操作。");
    if (successfulRetry(db, row, input.action, input.expectedVersion, actorId, input.archiveNow)) { db.exec("COMMIT"); return row; }
    if (Number(row.version) !== input.expectedVersion) throw new ApprovalLifecycleError(409, "CONFLICT", "审批版本已更新，请刷新后重试。");
    assertActivityActive(row);
    const recipients = db.prepare("SELECT member_id,action FROM workspace_activity_responses WHERE activity_id=?").all(id);
    const approved = recipients.length > 0 && recipients.every(response => response.action === "approved");
    if (input.action === "complete" && !approved) throw new ApprovalLifecycleError(400, "APPROVAL_REQUIRED", "全部审批通过后，申请人才能标记任务已完成。");
    if (input.action === "withdraw" && approved) throw new ApprovalLifecycleError(400, "ALREADY_APPROVED", "审批通过后不能撤回，请在执行后标记任务已完成。");
    const at = now.toISOString(), complete = input.action === "complete", immediateArchive = complete && input.archiveNow;
    db.prepare("UPDATE workspace_activity SET status=?,completed_at=?,withdrawn_at=?,archived_at=?,archive_at=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND status='active'")
      .run(immediateArchive ? "archived" : complete ? "completed" : "withdrawn", complete ? at : null, complete ? null : at, immediateArchive ? at : null, complete ? immediateArchive ? at : nextShanghaiMidnight(now) : null, at, id, input.expectedVersion);
    db.prepare("INSERT INTO workspace_activity_audit(id,activity_id,actor_id,action,note,created_at) VALUES(?,?,?,?,?,?)")
      .run(randomUUID(), id, actorId, complete ? "approval_completed" : "approval_withdrawn", JSON.stringify({ expectedVersion: input.expectedVersion, version: input.expectedVersion + 1, ...(complete ? { archiveNow: immediateArchive } : {}) }), at);
    if (immediateArchive) db.prepare("INSERT INTO workspace_activity_audit(id,activity_id,actor_id,action,note,created_at) VALUES(?,?,?,?,?,?)")
      .run(randomUUID(), id, actorId, "approval_archived", "申请人选择完成后立即归档", at);
    const targetUrl = activityNotificationUrl("approval", id);
    db.prepare("UPDATE member_notifications SET read_at=? WHERE target_url=? AND kind IN ('approval_requested','activity_updated') AND read_at IS NULL").run(at, targetUrl);
    insertNotifications(db, { recipientIds: recipients.map(recipient => String(recipient.member_id)).filter(member => activeMemberIds.includes(member)), actorId, kind: "activity_updated", projectId: row.project_id ? String(row.project_id) : null,
      message: `${row.approval_type === "reimbursement" ? "报销审批" : "审批"}「${String(row.title)}」${immediateArchive ? "已由申请人完成并归档" : complete ? "已由申请人标记任务完成" : "已由申请人撤回"}`, targetUrl, createdAt: at });
    const result = db.prepare("SELECT * FROM workspace_activity WHERE id=?").get(id)!;
    db.exec("COMMIT"); return result;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
