import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initializeDatabase } from "@/db/client";
import { createAvatarTemplate } from "@/organization/office-avatar";
import { createOfficeAvatarService } from "@/organization/office-avatar-service";
import { OfficeError, type OfficeActor } from "@/organization/office-contracts";
import type { Directory, Member } from "@/organization/contracts";

const actor: OfficeActor = { accountId: "account-member", memberId: "member", tenantId: "tenant-a", canManage: false };
const admin: OfficeActor = { accountId: "account-admin", memberId: "admin", tenantId: "tenant-a", canManage: true };
const outsider: OfficeActor = { accountId: "account-other", memberId: "other", tenantId: "tenant-b", canManage: true };
const member = (id: string, isAdmin = false): Member => ({ id, name: id, accountId: `account-${id}`, roles: isAdmin ? ["org_admin"] : ["viewer"], active: true, isPlaceholder: false, title: "", username: id, departmentId: null, phone: "", email: "", wechat: "", sourceNotes: "", version: 1 });
let db: DatabaseSync;
let directory: Directory;
let service: ReturnType<typeof createOfficeAvatarService>;
beforeEach(() => {
  db = new DatabaseSync(":memory:"); initializeDatabase(db);
  directory = { departments: [], members: [member("member"), member("admin", true), member("reader"), { ...member("inactive-admin", true), active: false }] };
  service = createOfficeAvatarService(db, {
    directory: tenant => tenant === "tenant-a" ? directory : { departments: [], members: [member("other", true)] },
    assertAdmin: who => { if (!((who.tenantId === "tenant-a" && who.accountId === "account-admin") || (who.tenantId === "tenant-b" && who.accountId === "account-other"))) throw new OfficeError(403, "FORBIDDEN", "仅管理员可审核。"); },
  });
});
afterEach(() => db.close());

describe("office avatar workflow", () => {
  it("keeps every pending review visible when newer processed history exceeds the history limit", async () => {
    const pending = await service.submit(actor, await createAvatarTemplate());
    db.prepare("UPDATE office_avatar_submissions SET created_at=? WHERE id=?").run("2026-01-01T00:00:00.000Z", pending.id);
    const insert = db.prepare("INSERT INTO office_avatar_submissions(id,tenant_id,member_id,png_content,status,created_at) VALUES(?,?,?,?,?,?)");
    for (let index = 0; index < 205; index++) insert.run(`history-${index}`, actor.tenantId, actor.memberId, Buffer.from([1]), "rejected", "2026-02-01T00:00:00.000Z");
    for (let index = 0; index < 205; index++) insert.run(`pending-${index}`, actor.tenantId, `other-member-${index}`, Buffer.from([1]), "pending", "2026-01-02T00:00:00.000Z");
    const queue = service.list(admin);
    expect(queue.filter(item => item.status === "pending")).toHaveLength(206);
    expect(queue.slice(0, 206).every(item => item.status === "pending")).toBe(true);
    expect(queue.find(item => item.id === pending.id)).toBeDefined();
    expect(queue.filter(item => item.status !== "pending")).toHaveLength(200);
    expect(queue.find(item => item.id === "history-0")).toBeUndefined();
    expect(queue.find(item => item.id === "history-204")).toBeDefined();
    expect(queue.some(item => "png_content" in item)).toBe(false);
  });
  it("replays upload and review retries without duplicating submissions or notifications", async () => {
    const png = await createAvatarTemplate();
    const first = await service.submit(actor, png, "upload-key");
    expect(await service.submit(actor, png, "upload-key")).toEqual(first);
    expect(db.prepare("SELECT COUNT(*) AS count FROM office_avatar_submissions").get()?.count).toBe(1);
    const decision = { expectedVersion: 1, decision: "approve" as const, note: "" };
    const approved = service.review(admin, first.id, decision, "review-key");
    expect(service.review(admin, first.id, decision, "review-key")).toEqual(approved);
    expect(() => service.review(admin, first.id, { ...decision, decision: "reject", note: "修改决定" }, "review-key")).toThrow(/幂等键/);
    expect(db.prepare("SELECT COUNT(*) AS count FROM member_notifications").get()?.count).toBe(2);
  });
  it("uploads only for the verified member and notifies valid same-tenant admins", async () => {
    const submission = await service.submit(actor, await createAvatarTemplate());
    expect(submission).toMatchObject({ memberId: "member", memberName: "member", status: "pending", version: 1 });
    expect(service.latest(actor)).toEqual(submission);
    expect(service.list(admin)).toEqual([submission]);
    expect(db.prepare("SELECT recipient_id,kind FROM member_notifications").all()).toEqual([{ recipient_id: "admin", kind: "approval_requested" }]);
    await expect(service.submit({ ...actor, memberId: "admin" }, await createAvatarTemplate())).rejects.toThrow();
    expect(() => service.list({ ...actor, canManage: true })).toThrow();
  });
  it("keeps unapproved bytes private to the owner and tenant admin", async () => {
    const submission = await service.submit(actor, await createAvatarTemplate());
    const reader = { ...actor, memberId: "reader", accountId: "account-reader" };
    expect(service.read(actor, submission.id)).toBeInstanceOf(Buffer);
    expect(service.read(admin, submission.id)).toBeInstanceOf(Buffer);
    expect(() => service.read(reader, submission.id)).toThrow();
    expect(() => service.read(outsider, submission.id)).toThrow();
    expect(() => service.review(outsider, submission.id, { expectedVersion: 1, decision: "approve", note: "" })).toThrow();
    expect(service.list(outsider)).toEqual([]);
  });
  it("approves with version checks, publishes to members and preserves desk customization", async () => {
    const submission = await service.submit(actor, await createAvatarTemplate());
    db.prepare("INSERT INTO office_member_styles(tenant_id,member_id,desk_color,desk_shape,version) VALUES(?,?,?,?,?)").run("tenant-a", "member", "#123456", "round", 7);
    const approved = service.review(admin, submission.id, { expectedVersion: 1, decision: "approve", note: "通过" });
    expect(approved).toMatchObject({ status: "approved", version: 2, reviewNote: "通过" });
    expect(service.read({ ...actor, memberId: "reader", accountId: "account-reader" }, submission.id)).toBeInstanceOf(Buffer);
    expect(db.prepare("SELECT approved_avatar_id,desk_color,desk_shape,version FROM office_member_styles").get()).toEqual({ approved_avatar_id: submission.id, desk_color: "#123456", desk_shape: "round", version: 8 });
    expect(() => service.review(admin, submission.id, { expectedVersion: 1, decision: "reject", note: "重复审核" })).toThrow(/已更新|已完成/);
    expect(() => service.review(admin, submission.id, { expectedVersion: 2, decision: "reject", note: "重复审核" })).toThrow(/已更新|已完成/);
    expect(db.prepare("SELECT COUNT(*) AS count FROM member_notifications WHERE kind='approval_decided'").get()?.count).toBe(1);
  });
  it("replaces pending submissions without overwriting the currently approved avatar", async () => {
    const first = await service.submit(actor, await createAvatarTemplate());
    service.review(admin, first.id, { expectedVersion: 1, decision: "approve", note: "" });
    const pending = await service.submit(actor, await createAvatarTemplate());
    const newest = await service.submit(actor, await createAvatarTemplate());
    expect(service.latest(actor)?.id).toBe(newest.id);
    expect(service.list(admin).find(row => row.id === pending.id)).toMatchObject({ status: "rejected", version: 2, reviewNote: "已被新提交替代" });
    expect(() => service.review(admin, pending.id, { expectedVersion: 1, decision: "approve", note: "" })).toThrow();
    expect(db.prepare("SELECT approved_avatar_id FROM office_member_styles").get()?.approved_avatar_id).toBe(first.id);
    service.review(admin, newest.id, { expectedVersion: 1, decision: "reject", note: "请补充人物轮廓" });
    expect(service.latest(actor)).toMatchObject({ status: "rejected", reviewNote: "请补充人物轮廓" });
    expect(db.prepare("SELECT approved_avatar_id FROM office_member_styles").get()?.approved_avatar_id).toBe(first.id);
  });
  it("rechecks active account membership and rolls back when notification insertion fails", async () => {
    directory = { ...directory, members: directory.members.map(entry => entry.id === "member" ? { ...entry, active: false } : entry) };
    await expect(service.submit(actor, await createAvatarTemplate())).rejects.toThrow();
    directory = { ...directory, members: directory.members.map(entry => ({ ...entry, active: true })) };
    db.exec("CREATE TRIGGER reject_avatar_notification BEFORE INSERT ON member_notifications BEGIN SELECT RAISE(ABORT,'test failure'); END;");
    await expect(service.submit(actor, await createAvatarTemplate())).rejects.toThrow();
    expect(db.prepare("SELECT COUNT(*) AS count FROM office_avatar_submissions").get()?.count).toBe(0);
  });
});
