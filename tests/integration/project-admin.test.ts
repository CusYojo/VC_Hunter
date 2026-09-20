import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import { createAdminProject, updateAdminProject } from "@/workbench/project-admin";
import { SqliteProjectRepository } from "@/repositories/projects";
let db: DatabaseSync;
const admin = { tenantId: "org-a", id: "admin-a", roles: ["org_admin"] };
const input = { name: "管理员新增项目", legalName: "新项目科技有限公司", track: "半导体", executiveSummary: "已接洽，需要补充技术材料。", technologyStage: "样机验证", discoveryReason: "收到项目介绍" };
beforeEach(() => { db = createDatabase(":memory:"); initializeDatabase(db); seedDemoData(db); });
afterEach(() => db.close());
describe("administrator project content management", () => {
  it("creates a project with unscored values and audit and repeats idempotently", () => {
    const project = createAdminProject(db, admin, input, "create");
    expect(project).toMatchObject({ name: input.name, legalName: input.legalName, track: "半导体", status: "new", version: 1, executiveSummary: input.executiveSummary });
    expect(project.urgencyScore).toBeUndefined();
    expect(createAdminProject(db, admin, input, "create").id).toBe(project.id);
    expect(() => createAdminProject(db, admin, { ...input, name: "不同项目" }, "create")).toThrow(/幂等/);
    expect(db.prepare("SELECT count(*) n FROM audit_log WHERE action='project.created'").get()?.n).toBe(1);
    expect(db.prepare("SELECT count(*) n FROM platform_timeline WHERE project_id=? AND event_type='project.created'").get(project.id)?.n).toBe(1);
  });
  it("updates content and preserves source assertions, assigned people and uploaded files", () => {
    const repository = new SqliteProjectRepository(db);
    const before = repository.findById("project-qiongxin")!;
    const patch = { expectedVersion: before.version, name: "更新后的项目名", executiveSummary: "人工更新简介", riskFlags: ["材料需复核"], openQuestions: ["最新验证进展？"] };
    const updated = updateAdminProject(db, admin, before.id, patch, "update");
    expect(updated).toMatchObject({ name: patch.name, executiveSummary: patch.executiveSummary, version: before.version + 1, riskFlags: patch.riskFlags, openQuestions: patch.openQuestions });
    expect(updated.assertions).toEqual(before.assertions); expect(updated.owners).toEqual(before.owners);
    expect(updateAdminProject(db, admin, before.id, patch, "update").version).toBe(updated.version);
    expect(() => updateAdminProject(db, admin, before.id, patch, "stale")).toThrow(/版本/);
  });
  it("requires the admin role instead of a specific display name and rejects unsafe fields", () => {
    for (const roles of [["investment_manager"], ["viewer"], []]) expect(() => createAdminProject(db, { ...admin, id: "示例经理", roles }, input, "forbidden")).toThrow(/管理员/);
    expect(() => createAdminProject(db, admin, { ...input, owner: "伪造负责人" }, "owner")).toThrow();
    expect(() => createAdminProject(db, admin, { ...input, track: "不支持的赛道" }, "track")).toThrow();
    expect(() => updateAdminProject(db, admin, "project-qiongxin", { expectedVersion: 1, companyId: "foreign" }, "company")).toThrow();
  });
  it("rolls back company, project and metadata writes when auditing fails", () => {
    const projects = db.prepare("SELECT count(*) n FROM projects").get()?.n;
    const companies = db.prepare("SELECT count(*) n FROM companies").get()?.n;
    db.exec("CREATE TRIGGER fail_admin_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT,'failed'); END");
    expect(() => createAdminProject(db, admin, input, "rollback")).toThrow();
    expect(db.prepare("SELECT count(*) n FROM projects").get()?.n).toBe(projects);
    expect(db.prepare("SELECT count(*) n FROM companies").get()?.n).toBe(companies);
    const before = new SqliteProjectRepository(db).findById("project-qiongxin")!;
    expect(() => updateAdminProject(db, admin, before.id, { expectedVersion: before.version, name: "未保存" }, "editrollback")).toThrow();
    expect(new SqliteProjectRepository(db).findById(before.id)).toEqual(before);
  });
});
