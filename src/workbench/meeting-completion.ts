import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { activityNotificationUrl, insertNotifications } from "./notifications";

const inputSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();
const finished = new Set(["done", "approved", "declined", "returned", "change_requested"]);
/** A deliberate edit begins a new lifecycle; response actions never reopen a completed meeting. */
export const meetingLifecycleSql = `(SELECT action FROM workspace_activity_audit WHERE activity_id=a.id AND action IN ('meeting_completed','edited') ORDER BY rowid DESC LIMIT 1)`;
export class MeetingCompletionError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export function isMeetingCompleted(db: DatabaseSync, id: string): boolean {
  return db.prepare(`SELECT ${meetingLifecycleSql} AS lifecycle FROM workspace_activity a WHERE a.id=?`).get(id)?.lifecycle === "meeting_completed";
}

export function completeMeeting(db: DatabaseSync, id: string, raw: unknown, actor: { memberId: string; canManage: boolean }, activeMemberIds: readonly string[]) {
  const input = inputSchema.parse(raw);
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT * FROM workspace_activity WHERE id=?").get(id);
    if (!row) throw new MeetingCompletionError(404, "NOT_FOUND", "会议不存在。");
    if (!activeMemberIds.includes(actor.memberId) || (row.created_by !== actor.memberId && !actor.canManage)) throw new MeetingCompletionError(403, "FORBIDDEN", "只有会议创建人或管理员可以结束会议。");
    if (row.kind !== "meeting") throw new MeetingCompletionError(400, "INVALID_OPERATION", "只有会议可以执行结束操作。");
    const version = Number(row.version);
    const completed = isMeetingCompleted(db, id);
    if (input.expectedVersion !== version && !(completed && input.expectedVersion === version - 1)) throw new MeetingCompletionError(409, "CONFLICT", "会议已更新，请刷新后重试。");
    if (!completed) {
      const now = new Date().toISOString();
      const recipients = db.prepare("SELECT member_id,action FROM workspace_activity_responses WHERE activity_id=?").all(id).filter(item => !finished.has(String(item.action)));
      for (const recipient of recipients) db.prepare("UPDATE workspace_activity_responses SET action='done',responded_at=? WHERE activity_id=? AND member_id=?").run(now, id, String(recipient.member_id));
      db.prepare("UPDATE workspace_activity SET version=version+1,updated_at=? WHERE id=? AND version=?").run(now, id, version);
      db.prepare("INSERT INTO workspace_activity_audit(id,activity_id,actor_id,action,note,created_at) VALUES(?,?,?,?,?,?)").run(randomUUID(), id, actor.memberId, "meeting_completed", JSON.stringify({ version: version + 1 }), now);
      insertNotifications(db, { recipientIds: [String(row.created_by), ...recipients.map(item => String(item.member_id))].filter(memberId => activeMemberIds.includes(memberId)), actorId: actor.memberId, kind: "activity_updated", projectId: row.project_id ? String(row.project_id) : null, message: `会议「${String(row.title)}」已结束`, targetUrl: activityNotificationUrl("meeting", id), createdAt: now });
    }
    db.exec("COMMIT");
    return { id, version: version + Number(!completed), completed: true };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
