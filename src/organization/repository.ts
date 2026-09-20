import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ORGANIZATION_ROLE_VALUES } from "@/security/roles";
import { OrganizationError, createDepartmentSchema, updateDepartmentSchema, updateMemberSchema, type Department, type Member, type Directory, type PublicDirectory, type OrganizationActor, type CreateDepartmentInput, type UpdateDepartmentInput, type UpdateMemberInput } from "./contracts";

export function transaction<T>(db: DatabaseSync, operation: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try { const result = operation(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; }
}
const fail = (status: number, code: string, message: string): never => { throw new OrganizationError(status, code, message); };
const nullable = (value: unknown) => value === null ? null : String(value);

export class OrganizationRepository {
  constructor(readonly database: DatabaseSync) {}
  assertAdmin(actor: OrganizationActor) {
    const row = this.database.prepare("SELECT roles FROM workspace_memberships WHERE user_id = ? AND tenant_id = ? AND active = 1").get(actor.accountId, actor.tenantId);
    if (!row || !z.array(z.enum(ORGANIZATION_ROLE_VALUES)).parse(JSON.parse(String(row.roles))).includes("org_admin")) fail(403, "FORBIDDEN", "仅管理员可管理组织。");
  }
  audit(tenantId: string, actorId: string, action: string, targetId: string) {
    this.database.prepare("INSERT INTO organization_audit(id,tenant_id,actor_id,action,target_id,created_at) VALUES(?,?,?,?,?,?)").run(randomUUID(), tenantId, actorId, action, targetId, Date.now());
  }
  directory(tenantId: string): Directory {
    const departments = this.database.prepare("SELECT * FROM organization_departments WHERE tenant_id = ? ORDER BY sort_order, id").all(tenantId).map((r): Department => ({ id: String(r.id), name: String(r.name), parentId: nullable(r.parent_id), expectedHeadcount: r.expected_headcount === null ? null : Number(r.expected_headcount), notes: String(r.notes), sortOrder: Number(r.sort_order), version: Number(r.version) }));
    const members = this.database.prepare(`SELECT p.*, u.username, COALESCE(u.name, p.name) AS display_name, m.roles, m.active AS membership_active FROM organization_members p
      LEFT JOIN user u ON u.id = p.account_id LEFT JOIN workspace_memberships m ON m.user_id = p.account_id AND m.team_user_id = p.id AND m.tenant_id = p.tenant_id
      WHERE p.tenant_id = ? ORDER BY p.id`).all(tenantId).map((r): Member => ({ id: String(r.id), accountId: nullable(r.account_id), name: String(r.display_name), username: nullable(r.username), title: String(r.title), departmentId: nullable(r.department_id), phone: String(r.phone), email: String(r.email), wechat: String(r.wechat), active: r.account_id === null ? Boolean(r.active) : Boolean(r.membership_active), roles: r.roles ? z.array(z.enum(ORGANIZATION_ROLE_VALUES)).parse(JSON.parse(String(r.roles))) : [], isPlaceholder: Boolean(r.is_placeholder), sourceNotes: String(r.source_notes), version: Number(r.version) }));
    return { departments, members };
  }
  publicDirectory(tenantId: string): PublicDirectory {
    const directory = this.directory(tenantId);
    return { departments: directory.departments, members: directory.members.map(({ id, name, title, departmentId, active, isPlaceholder, version }) => ({ id, name, title, departmentId, active, isPlaceholder, version })) };
  }
  assertDepartment(tenantId: string, id: string | null) {
    if (id !== null && !this.database.prepare("SELECT id FROM organization_departments WHERE id = ? AND tenant_id = ?").get(id, tenantId)) fail(400, "INVALID_DEPARTMENT", "部门不存在。");
  }
  private validateParent(tenantId: string, id: string, parentId: string | null) {
    this.assertDepartment(tenantId, parentId);
    const seen = new Set([id]);
    let cursor = parentId;
    while (cursor !== null) {
      if (seen.has(cursor)) fail(400, "DEPARTMENT_CYCLE", "部门层级不能形成循环。");
      seen.add(cursor);
      const row = this.database.prepare("SELECT parent_id FROM organization_departments WHERE id = ? AND tenant_id = ?").get(cursor, tenantId);
      cursor = row?.parent_id ? String(row.parent_id) : null;
    }
  }
  createDepartment(actor: OrganizationActor, input: CreateDepartmentInput): Department {
    const data = createDepartmentSchema.parse(input);
    return transaction(this.database, () => {
      this.assertAdmin(actor); this.assertDepartment(actor.tenantId, data.parentId);
      const id = randomUUID();
      this.database.prepare("INSERT INTO organization_departments(id,tenant_id,name,parent_id,expected_headcount,notes,sort_order) VALUES(?,?,?,?,?,?,?)").run(id, actor.tenantId, data.name, data.parentId, data.expectedHeadcount, data.notes, data.sortOrder);
      this.audit(actor.tenantId, actor.accountId, "department.created", id);
      return { id, ...data, version: 1 };
    });
  }
  updateDepartment(actor: OrganizationActor, id: string, input: UpdateDepartmentInput): Department {
    const { expectedVersion, ...patch } = updateDepartmentSchema.parse(input);
    return transaction(this.database, () => {
      this.assertAdmin(actor);
      const current = this.directory(actor.tenantId).departments.find((row) => row.id === id);
      if (!current) return fail(404, "NOT_FOUND", "部门不存在。");
      if (current.version !== expectedVersion) fail(409, "VERSION_CONFLICT", "信息已更新，请刷新后重试。");
      const next = { ...current, ...patch, version: current.version + 1 };
      this.validateParent(actor.tenantId, id, next.parentId);
      this.database.prepare("UPDATE organization_departments SET name=?,parent_id=?,expected_headcount=?,notes=?,sort_order=?,version=? WHERE id=? AND tenant_id=?").run(next.name, next.parentId, next.expectedHeadcount, next.notes, next.sortOrder, next.version, id, actor.tenantId);
      this.audit(actor.tenantId, actor.accountId, "department.updated", id); return next;
    });
  }
  updateMember(actor: OrganizationActor, id: string, input: UpdateMemberInput): Member {
    const { expectedVersion, ...patch } = updateMemberSchema.parse(input);
    return transaction(this.database, () => {
      this.assertAdmin(actor);
      const directory = this.directory(actor.tenantId);
      const current = directory.members.find((row) => row.id === id);
      if (!current) return fail(404, "NOT_FOUND", "人员不存在。");
      if (current.version !== expectedVersion) fail(409, "VERSION_CONFLICT", "信息已更新，请刷新后重试。");
      const next = { ...current, ...patch, version: current.version + 1 };
      this.assertDepartment(actor.tenantId, next.departmentId);
      if (current.isPlaceholder && patch.roles) fail(400, "PLACEHOLDER_ACCOUNT", "未确认实名人员不能设置账号权限。");
      if (current.accountId === actor.accountId && (!next.active || current.roles.some((role) => !next.roles.includes(role)))) fail(409, "SELF_DEMOTION", "不能停用或降低自己的权限。");
      if (current.active && current.roles.includes("org_admin") && (!next.active || !next.roles.includes("org_admin"))) {
        const admins = this.database.prepare("SELECT user_id, roles FROM workspace_memberships WHERE tenant_id=? AND active=1").all(actor.tenantId).filter((row) => JSON.parse(String(row.roles)).includes("org_admin"));
        if (admins.length <= 1) fail(409, "LAST_ADMIN", "至少保留一名有效管理员。");
      }
      this.database.prepare("UPDATE organization_members SET name=?,title=?,department_id=?,phone=?,email=?,wechat=?,active=?,version=? WHERE id=? AND tenant_id=?").run(next.name, next.title, next.departmentId, next.phone, next.email, next.wechat, Number(next.active), next.version, id, actor.tenantId);
      if (current.accountId) {
        this.database.prepare("UPDATE user SET name=?,updatedAt=? WHERE id=?").run(next.name, Date.now(), current.accountId);
        this.database.prepare("UPDATE workspace_memberships SET roles=?,active=? WHERE user_id=? AND team_user_id=? AND tenant_id=?").run(JSON.stringify(next.roles), Number(next.active), current.accountId, id, actor.tenantId);
        if (!next.active || JSON.stringify(next.roles) !== JSON.stringify(current.roles)) this.database.prepare("DELETE FROM session WHERE userId=?").run(current.accountId);
      }
      this.audit(actor.tenantId, actor.accountId, "member.updated", id); return next;
    });
  }
}
