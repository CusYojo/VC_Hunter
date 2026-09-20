// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { officeMemberProfilesMigration } from "@/db/office-member-profiles-migration";

let db: DatabaseSync;
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE office_department_settings(tenant_id TEXT NOT NULL,department_id TEXT NOT NULL,grouping_mode TEXT NOT NULL,PRIMARY KEY(tenant_id,department_id));
    CREATE TABLE office_seats(tenant_id TEXT NOT NULL,group_id TEXT NOT NULL,member_id TEXT NOT NULL,x INTEGER NOT NULL,y INTEGER NOT NULL,PRIMARY KEY(tenant_id,group_id,member_id));
  `);
});
afterEach(() => db.close());

it("maps obsolete investment office settings to the canonical department and removes stale seats", () => {
  db.prepare("INSERT INTO office_department_settings VALUES(?,?,?)").run("tenant", "dept-investment-one", "project");
  db.prepare("INSERT INTO office_department_settings VALUES(?,?,?)").run("tenant", "dept-investment", "project");
  db.prepare("INSERT INTO office_seats VALUES(?,?,?,?,?)").run("tenant", "department:dept-investment-one", "member", 1, 1);
  db.exec(officeMemberProfilesMigration.upSql);
  expect(db.prepare("SELECT department_id,grouping_mode FROM office_department_settings").all()).toEqual([{ department_id: "dept-investment", grouping_mode: "department" }]);
  expect(db.prepare("SELECT * FROM office_seats").all()).toEqual([]);
  expect(db.prepare("SELECT grouping_mode,presence_status,version FROM office_member_profiles WHERE tenant_id=? AND member_id=?").get("tenant", "member")).toBeUndefined();
});

it("enforces bounded profile values in storage", () => {
  db.exec(officeMemberProfilesMigration.upSql);
  expect(() => db.prepare("INSERT INTO office_member_profiles(tenant_id,member_id,presence_status,custom_status) VALUES(?,?,?,?)").run("tenant", "member", "office", "不应保留")).toThrow();
  expect(() => db.prepare("INSERT INTO office_member_profiles(tenant_id,member_id,description) VALUES(?,?,?)").run("tenant", "member", "x".repeat(161))).toThrow();
});
