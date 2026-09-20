import { afterEach, beforeEach, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import { SqliteProjectRepository } from "@/repositories/projects";
import { assignProject } from "@/services/project-assignment";
let db: DatabaseSync;
let repository: SqliteProjectRepository;
const base = { projectId: "project-qiongxin", expectedVersion: 1, reviewer: "user-demo", requestId: "multi" };
beforeEach(() => { db = createDatabase(":memory:"); initializeDatabase(db); seedDemoData(db); repository = new SqliteProjectRepository(db); });
afterEach(() => db.close());
it("deduplicates multiple responsible people and preserves first-owner compatibility", () => {
  const result = assignProject(repository, { ...base, assignees: ["示例经理", "林川", "示例经理"] });
  expect(result).toMatchObject({ owner: "示例经理", owners: ["示例经理", "林川"], version: 2 });
  expect(repository.findById(base.projectId)?.owners).toEqual(["示例经理", "林川"]);
  expect(repository.list().find(p => p.id === base.projectId)?.owners).toEqual(["示例经理", "林川"]);
  expect(assignProject(repository, { ...base, assignees: ["示例经理", "林川"] })).toEqual(result);
  expect(() => assignProject(repository, { ...base, assignees: ["林川"] })).toThrow(/幂等/);
});
it("rejects invalid members, empty selection and stale versions without partial writes", () => {
  expect(() => assignProject(repository, { ...base, assignees: ["林川", "不存在"] })).toThrow(/团队成员/);
  expect(() => assignProject(repository, { ...base, assignees: [] })).toThrow();
  const first = assignProject(repository, { ...base, assignee: "林川" });
  expect(first.owner).toBe("林川");
  expect(() => assignProject(repository, { ...base, requestId: "stale", assignees: ["示例经理", "周宁"] })).toThrow(/Version conflict/);
  expect(repository.findById(base.projectId)?.owners).toEqual(["林川"]);
  expect(db.prepare("SELECT count(*) n FROM audit_log WHERE action='project.assigned'").get()?.n).toBe(1);
});
it("rolls ownership and legacy owner back together when audit storage fails", () => {
  const before = repository.findById(base.projectId);
  db.exec("CREATE TRIGGER fail_multi_audit BEFORE INSERT ON audit_log WHEN NEW.action='project.assigned' BEGIN SELECT RAISE(ABORT, 'failed'); END");
  expect(() => assignProject(repository, { ...base, assignees: ["林川", "周宁"] })).toThrow();
  expect(repository.findById(base.projectId)).toEqual(before);
  expect(db.prepare("SELECT count(*) n FROM project_responsibles").get()?.n).toBe(0);
});

it("backfills historical owners without treating unrelated project members as responsible", async () => {
  const { projectResponsiblesMigration } = await import("@/workbench/project-responsibles-migration");
  db.exec(projectResponsiblesMigration.downSql);
  db.prepare("UPDATE projects SET owner='原负责人' WHERE id=?").run(base.projectId);
  db.exec(projectResponsiblesMigration.upSql);
  expect(repository.findById(base.projectId)?.owners).toEqual(["原负责人"]);
  expect(db.prepare("SELECT member_name,member_id FROM project_responsibles WHERE project_id=?").get(base.projectId)).toEqual({ member_name: "原负责人", member_id: null });
});
