import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import { insertNotifications } from "@/workbench/notifications";
import { transaction } from "./repository";
import { OfficeError, type OfficeActor } from "./office-contracts";
import type { AvatarReviewInput, AvatarSubmission } from "./office-avatar-contracts";

const targetUrl = "/organization/office?tab=avatars";
const fail = (status: number, code: string, message: string): never => { throw new OfficeError(status, code, message); };
const adminOnly = (actor: OfficeActor) => { if (!actor.canManage) fail(403, "FORBIDDEN", "仅管理员可审核头像。"); };
const mapSubmission = (row: Record<string, SQLOutputValue>, memberName: string): AvatarSubmission => ({
  id: String(row.id), memberId: String(row.member_id), memberName, status: row.status as AvatarSubmission["status"],
  version: Number(row.version), avatarUrl: `/api/v1/organization/office/avatars/${encodeURIComponent(String(row.id))}`,
  reviewNote: String(row.review_note), createdAt: String(row.created_at), reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
});

export class OfficeAvatarRepository {
  constructor(private readonly database: DatabaseSync) {}

  private replay(actor: OfficeActor, key: string | undefined, action: string, payload: string): string | null {
    if (!key) return null;
    const scope = JSON.stringify(["office-avatar", actor.tenantId, actor.accountId]);
    const prior = this.database.prepare("SELECT action,resource_id,payload_json FROM workbench_idempotency WHERE actor_id=? AND idempotency_key=?").get(scope, key);
    if (!prior) return null;
    if (prior.action !== action || prior.payload_json !== payload) return fail(409, "IDEMPOTENCY_CONFLICT", "幂等键已用于不同请求。");
    return String(prior.resource_id);
  }
  private remember(actor: OfficeActor, key: string | undefined, action: string, id: string, payload: string, now: string) {
    if (key) this.database.prepare("INSERT INTO workbench_idempotency(actor_id,idempotency_key,action,resource_id,payload_json,created_at) VALUES(?,?,?,?,?,?)")
      .run(JSON.stringify(["office-avatar", actor.tenantId, actor.accountId]), key, action, id, payload, now);
  }

  private audit(actor: OfficeActor, action: string, targetId: string, createdAt: string) {
    this.database.prepare("INSERT INTO office_audit(id,tenant_id,actor_id,action,target_id,created_at) VALUES(?,?,?,?,?,?)")
      .run(randomUUID(), actor.tenantId, actor.accountId, action, targetId, createdAt);
  }
  private row(tenantId: string, id: string) {
    const row = this.database.prepare("SELECT * FROM office_avatar_submissions WHERE tenant_id=? AND id=?").get(tenantId, id);
    if (!row) return fail(404, "NOT_FOUND", "头像不存在。");
    return row;
  }
  latest(actor: OfficeActor, name: string): AvatarSubmission | null {
    const row = this.database.prepare("SELECT * FROM office_avatar_submissions WHERE tenant_id=? AND member_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(actor.tenantId, actor.memberId);
    return row ? mapSubmission(row, name) : null;
  }
  list(actor: OfficeActor, names: ReadonlyMap<string, string>): AvatarSubmission[] {
    adminOnly(actor);
    const columns = "id,member_id,status,version,review_note,created_at,reviewed_at";
    // Pending work must never disappear behind the bounded review history.
    const pending = this.database.prepare(`SELECT ${columns} FROM office_avatar_submissions WHERE tenant_id=? AND status='pending' ORDER BY created_at DESC,rowid DESC`).all(actor.tenantId);
    const history = this.database.prepare(`SELECT ${columns} FROM office_avatar_submissions WHERE tenant_id=? AND status!='pending' ORDER BY created_at DESC,rowid DESC LIMIT 200`).all(actor.tenantId);
    return [...pending, ...history]
      .map(row => mapSubmission(row, names.get(String(row.member_id)) ?? "已离职成员"));
  }
  read(actor: OfficeActor, id: string): Buffer {
    const row = this.row(actor.tenantId, id);
    if (row.status !== "approved" && row.member_id !== actor.memberId && !actor.canManage) return fail(404, "NOT_FOUND", "头像不存在。");
    return Buffer.from(row.png_content as Uint8Array);
  }
  submit(actor: OfficeActor, png: Buffer, memberName: string, adminIds: readonly string[], key?: string): AvatarSubmission {
    return transaction(this.database, () => {
      const payload = createHash("sha256").update(png).digest("hex");
      const prior = this.replay(actor, key, "office.avatar.submit", payload);
      if (prior) return mapSubmission(this.row(actor.tenantId, prior), memberName);
      const now = new Date().toISOString();
      this.database.prepare("UPDATE office_avatar_submissions SET status='rejected',review_note='已被新提交替代',reviewed_at=?,version=version+1 WHERE tenant_id=? AND member_id=? AND status='pending'").run(now, actor.tenantId, actor.memberId);
      const id = randomUUID();
      this.database.prepare("INSERT INTO office_avatar_submissions(id,tenant_id,member_id,png_content,created_at) VALUES(?,?,?,?,?)").run(id, actor.tenantId, actor.memberId, png, now);
      insertNotifications(this.database, { recipientIds: adminIds, actorId: actor.memberId, kind: "approval_requested", message: `${memberName}提交了新的像素头像，待审核`, targetUrl, createdAt: now });
      this.audit(actor, "office.avatar.submitted", id, now);
      this.remember(actor, key, "office.avatar.submit", id, payload, now);
      return mapSubmission(this.row(actor.tenantId, id), memberName);
    });
  }
  review(actor: OfficeActor, id: string, input: AvatarReviewInput, names: ReadonlyMap<string, string>, key?: string): AvatarSubmission {
    adminOnly(actor);
    return transaction(this.database, () => {
      const payload = JSON.stringify({ id, ...input });
      const prior = this.replay(actor, key, "office.avatar.review", payload);
      if (prior) { const row = this.row(actor.tenantId, prior); return mapSubmission(row, names.get(String(row.member_id)) ?? "已离职成员"); }
      const current = this.row(actor.tenantId, id);
      if (current.version !== input.expectedVersion || current.status !== "pending") return fail(409, "VERSION_CONFLICT", "头像已更新或已完成审核，请刷新后重试。");
      const now = new Date().toISOString(); const status = input.decision === "approve" ? "approved" : "rejected";
      this.database.prepare("UPDATE office_avatar_submissions SET status=?,review_note=?,reviewed_by=?,reviewed_at=?,version=version+1 WHERE tenant_id=? AND id=? AND version=? AND status='pending'")
        .run(status, input.note, actor.memberId, now, actor.tenantId, id, input.expectedVersion);
      const memberId = String(current.member_id);
      if (status === "approved") this.database.prepare(`INSERT INTO office_member_styles(tenant_id,member_id,approved_avatar_id,version) VALUES(?,?,?,2)
        ON CONFLICT(tenant_id,member_id) DO UPDATE SET approved_avatar_id=excluded.approved_avatar_id,version=office_member_styles.version+1`).run(actor.tenantId, memberId, id);
      insertNotifications(this.database, { recipientIds: [memberId], actorId: actor.memberId, kind: "approval_decided", message: status === "approved" ? "你的像素头像已审核通过" : `你的像素头像未通过审核${input.note ? `：${input.note}` : ""}`, targetUrl, createdAt: now });
      this.audit(actor, `office.avatar.${status}`, id, now);
      this.remember(actor, key, "office.avatar.review", id, payload, now);
      return mapSubmission(this.row(actor.tenantId, id), names.get(memberId) ?? "已离职成员");
    });
  }
}
