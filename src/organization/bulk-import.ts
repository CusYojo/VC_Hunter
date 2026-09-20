import { randomUUID } from "node:crypto";
import { createLocalAccountIssuer } from "@better-auth/core/db";
import { z } from "zod";
import { OrganizationRepository, transaction } from "./repository";
import { rosterSchema, type OrganizationRoster, OrganizationError } from "./contracts";

type PasswordHasher = { hash: (password: string) => Promise<string> };
export async function bulkImport(repository: OrganizationRepository, hasher: PasswordHasher, input: OrganizationRoster, password: string, options: { allowShortPassword?: boolean } = {}) {
  const roster = rosterSchema.parse(input);
  z.string().min(options.allowShortPassword === true ? 8 : 14).max(128).refine((value) => !/[\r\n\0]/.test(value)).parse(password);
  if (new Set(roster.departments.map((row) => row.id)).size !== roster.departments.length || new Set(roster.members.map((row) => row.id)).size !== roster.members.length) throw new OrganizationError(400, "DUPLICATE_ID", "导入标识不能重复。");
  const names = roster.members.filter((row) => !row.isPlaceholder).map((row) => row.username);
  if (new Set(names).size !== names.length) throw new OrganizationError(409, "USERNAME_CONFLICT", "导入账号名不能重复。");
  const db = repository.database;
  // Compute independent salted hashes outside SQLite's write transaction.
  const hashes = new Map<string, string>();
  for (const member of roster.members) {
    if (member.isPlaceholder !== (member.username === null)) throw new OrganizationError(400, "INVALID_PLACEHOLDER", "占位岗位不能创建账号，实名人员需提供账号名。");
    if (!member.isPlaceholder && !db.prepare("SELECT id FROM workspace_memberships WHERE team_user_id=?").get(member.id)) hashes.set(member.id, await hasher.hash(password));
  }
  return transaction(db, () => {
    let createdDepartments = 0; let createdMembers = 0; let createdAccounts = 0;
    // Insert parents first; unresolved/cyclic trees fail and roll back the whole import.
    let remaining = [...roster.departments];
    while (remaining.length) {
      const pending: typeof remaining = [];
      for (const department of remaining) {
        const existing = db.prepare("SELECT tenant_id FROM organization_departments WHERE id=?").get(department.id);
        if (existing) {
          if (existing.tenant_id !== roster.tenantId) throw new OrganizationError(409, "TENANT_CONFLICT", "部门标识已被占用。");
          continue;
        }
        if (department.parentId && !db.prepare("SELECT id FROM organization_departments WHERE id=? AND tenant_id=?").get(department.parentId, roster.tenantId)) { pending.push(department); continue; }
        db.prepare("INSERT INTO organization_departments(id,tenant_id,name,parent_id,expected_headcount,notes,sort_order) VALUES(?,?,?,?,?,?,?)").run(department.id, roster.tenantId, department.name, department.parentId, department.expectedHeadcount, department.notes, department.sortOrder);
        createdDepartments += 1;
      }
      if (pending.length === remaining.length) throw new OrganizationError(400, "INVALID_DEPARTMENT_TREE", "部门层级存在循环或缺失父部门。");
      remaining = pending;
    }
    for (const member of roster.members) {
      repository.assertDepartment(roster.tenantId, member.departmentId);
      const existing = db.prepare("SELECT tenant_id, is_placeholder FROM organization_members WHERE id=?").get(member.id);
      if (existing) {
        if (existing.tenant_id !== roster.tenantId || Boolean(existing.is_placeholder) !== member.isPlaceholder) throw new OrganizationError(409, "MEMBER_CONFLICT", "人员标识已被占用。");
        continue;
      }
      const binding = db.prepare("SELECT m.user_id,m.tenant_id,u.username FROM workspace_memberships m JOIN user u ON u.id=m.user_id WHERE m.team_user_id=?").get(member.id);
      let accountId: string | null = null;
      if (member.isPlaceholder && binding) throw new OrganizationError(409, "MEMBER_CONFLICT", "占位岗位不能关联已有账号。");
      if (binding) {
        if (binding.tenant_id !== roster.tenantId || binding.username !== member.username) throw new OrganizationError(409, "ACCOUNT_MISMATCH", "已有成员账号与导入身份不一致。");
        accountId = String(binding.user_id);
      } else if (!member.isPlaceholder) {
        if (db.prepare("SELECT id FROM user WHERE lower(username)=?").get(member.username!)) throw new OrganizationError(409, "USERNAME_CONFLICT", "账号名称已被使用。");
        const hash = hashes.get(member.id);
        if (!hash) throw new OrganizationError(409, "CONCURRENT_CHANGE", "成员状态变化，请重试导入。");
        accountId = randomUUID(); const now = Date.now();
        db.prepare("INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,username) VALUES(?,?,?,0,?,?,?)").run(accountId, member.name, `${accountId}@accounts.invalid`, now, now, member.username!);
        db.prepare("INSERT INTO account(id,userId,accountId,providerId,issuer,password,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)").run(randomUUID(), accountId, accountId, "credential", createLocalAccountIssuer("credential"), hash, now, now);
        db.prepare("INSERT INTO workspace_memberships(id,user_id,team_user_id,tenant_id,roles,active) VALUES(?,?,?,?,?,1)").run(randomUUID(), accountId, member.id, roster.tenantId, JSON.stringify(["viewer"]));
        createdAccounts += 1;
      }
      db.prepare("INSERT INTO organization_members(id,tenant_id,account_id,name,title,department_id,is_placeholder,source_notes) VALUES(?,?,?,?,?,?,?,?)").run(member.id, roster.tenantId, accountId, member.name, member.title, member.departmentId, Number(member.isPlaceholder), member.sourceNotes);
      createdMembers += 1;
    }
    if (createdDepartments || createdMembers || createdAccounts) repository.audit(roster.tenantId, "offline-admin", "roster.imported", "organization");
    return { createdDepartments, createdMembers, createdAccounts };
  });
}
