// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { beforeEach, afterEach, expect, it } from "vitest";
import { createAuthService } from "@/auth/service";
import { authorizeApiRequest } from "@/security/api-policy";

let db: DatabaseSync;
let auth: ReturnType<typeof createAuthService>;
const password = randomBytes(24).toString("hex");
beforeEach(async () => {
  db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  auth = createAuthService({ database: db, secret: randomBytes(32).toString("hex"), baseURL: "http://localhost:3199", rateLimit: false });
  await auth.migrate();
});
afterEach(() => db.close());
async function fixture() {
  const admin = await auth.invite({ username: "admin", name: "Existing Admin", password, teamUserId: "user-demo", tenantId: "test", roles: ["org_admin"] });
  const roster = { tenantId: "test", departments: [{ id: "investment", name: "投资部", parentId: null, expectedHeadcount: 3, notes: "", sortOrder: 0 }], members: [
    { id: "user-demo", name: "Existing Admin", username: "admin", title: "负责人", departmentId: "investment", isPlaceholder: false, sourceNotes: "" },
    { id: "member-1", name: "测试成员", username: "测试成员", title: "副总裁", departmentId: "investment", isPlaceholder: false, sourceNotes: "" },
    { id: "placeholder", name: "人事主管（待确认）", username: null, title: "人事主管", departmentId: null, isPlaceholder: true, sourceNotes: "截图无实名" },
  ] };
  await auth.organization.bulkImport(roster, password);
  return { admin, roster };
}

it("uses a versioned idempotent migration and atomically imports real accounts without elevating titles", async () => {
  const { admin, roster } = await fixture();
  await auth.migrate();
  expect(db.prepare('SELECT count(*) AS n FROM organization_schema_migrations').get()?.n).toBe(2);
  const directory = auth.organization.directory("test");
  expect(directory.members).toHaveLength(3);
  expect(directory.members.find((m) => m.id === "user-demo")).toMatchObject({ accountId: admin.id, roles: ["org_admin"] });
  expect(directory.members.find((m) => m.id === "member-1")).toMatchObject({ roles: ["viewer"], title: "副总裁", active: true });
  expect(directory.members.find((m) => m.id === "placeholder")).toMatchObject({ accountId: null, username: null, isPlaceholder: true });
  const accountBefore = db.prepare('SELECT * FROM account').all();
  const repeated = await auth.organization.bulkImport(roster, randomBytes(24).toString("hex"));
  expect(repeated.createdAccounts).toBe(0);
  expect(db.prepare('SELECT * FROM account').all()).toEqual(accountBefore);
  expect(auth.organization.directory("test")).toEqual(directory);
  const safe = auth.organization.publicDirectory("test");
  expect(JSON.stringify(safe)).not.toMatch(/username|accountId|roles|phone|wechat|email|sourceNotes/);
});

it("merges legacy investment departments without changing member or account ids", async () => {
  await fixture();
  db.prepare("DELETE FROM organization_schema_migrations WHERE version=2").run();
  db.prepare("INSERT INTO organization_departments(id,tenant_id,name,sort_order) VALUES(?,?,?,?)").run("dept-investment-one", "test", "投资一部", 8);
  db.prepare("INSERT INTO organization_departments(id,tenant_id,name,sort_order) VALUES(?,?,?,?)").run("dept-investment-two", "test", "投资二部", 9);
  db.prepare("INSERT INTO organization_departments(id,tenant_id,name,sort_order) VALUES(?,?,?,?)").run("dept-new-business", "test", "新业务部", 10);
  db.prepare("UPDATE organization_members SET department_id='dept-investment-one' WHERE id='member-1'").run();
  const before = db.prepare("SELECT id,account_id FROM organization_members WHERE id='member-1'").get();
  await auth.migrate();
  expect(db.prepare("SELECT id,account_id,department_id FROM organization_members WHERE id='member-1'").get()).toEqual({ ...before, department_id: "dept-investment" });
  expect(db.prepare("SELECT name,sort_order FROM organization_departments WHERE id='dept-investment'").get()).toEqual({ name: "投资部", sort_order: 2 });
  expect(db.prepare("SELECT id FROM organization_departments WHERE id IN ('dept-investment-one','dept-investment-two','dept-new-business')").all()).toEqual([]);
});

it("refuses to merge investment departments across tenants", async () => {
  await fixture();
  db.prepare("DELETE FROM organization_schema_migrations WHERE version=2").run();
  db.prepare("INSERT INTO organization_departments(id,tenant_id,name,sort_order) VALUES(?,?,?,?)").run("dept-investment", "tenant-other", "其他机构投资部", 1);
  db.prepare("INSERT INTO organization_departments(id,tenant_id,name,sort_order) VALUES(?,?,?,?)").run("dept-investment-one", "test", "投资一部", 8);

  await expect(auth.migrate()).rejects.toThrow(/租户/);
  expect(db.prepare("SELECT tenant_id,name FROM organization_departments WHERE id='dept-investment'").get()).toEqual({ tenant_id: "tenant-other", name: "其他机构投资部" });
  expect(db.prepare("SELECT tenant_id,name FROM organization_departments WHERE id='dept-investment-one'").get()).toEqual({ tenant_id: "test", name: "投资一部" });
  expect(db.prepare("SELECT version FROM organization_schema_migrations WHERE version=2").get()).toBeUndefined();
});

it("requires admin mutations, optimistic versions, prevents self-demotion and disables live membership/session", async () => {
  const { admin } = await fixture();
  const member = auth.organization.directory("test").members.find((m) => m.id === "member-1")!;
  const actor = { accountId: admin.id, tenantId: "test" };
  expect(() => auth.organization.updateMember({ accountId: member.accountId!, tenantId: "test" }, member.id, { expectedVersion: 1, title: "CEO" })).toThrow();
  expect(() => auth.organization.updateMember(actor, "user-demo", { expectedVersion: 1, roles: ["viewer"] })).toThrow();
  expect(() => auth.organization.updateMember(actor, "user-demo", { expectedVersion: 1, active: false })).toThrow();
  const signedIn = await auth.auth.handler(new Request("http://localhost:3199/api/auth/sign-in/username", { method: "POST", headers: { origin: "http://localhost:3199", "content-type": "application/json" }, body: JSON.stringify({ username: "测试成员", password }) }));
  expect(signedIn.status).toBe(200);
  const headers = new Headers({ cookie: signedIn.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") });
  auth.organization.updateMember(actor, member.id, { expectedVersion: 1, active: false, name: "新姓名", phone: "123", roles: ["researcher"] });
  expect(await auth.requireSession(headers)).toBeNull();
  expect(auth.membershipFor(member.accountId!)).toBeNull();
  expect(() => auth.organization.updateMember(actor, member.id, { expectedVersion: 1, title: "stale" })).toThrow();
  expect(db.prepare('SELECT name FROM user WHERE id = ?').get(member.accountId!)?.name).toBe("新姓名");
});

it("rejects invalid departments, cycles and stale edits", async () => {
  const { admin } = await fixture(); const actor = { accountId: admin.id, tenantId: "test" };
  const department = auth.organization.createDepartment(actor, { name: "研究组", parentId: "investment", expectedHeadcount: null, notes: "", sortOrder: 1 });
  expect(() => auth.organization.updateDepartment(actor, "investment", { parentId: department.id, expectedVersion: 1 })).toThrow();
  expect(() => auth.organization.updateDepartment(actor, department.id, { parentId: "missing", expectedVersion: 1 })).toThrow();
  auth.organization.updateDepartment(actor, department.id, { name: "研究部", expectedVersion: 1 });
  expect(() => auth.organization.updateDepartment(actor, department.id, { name: "stale", expectedVersion: 1 })).toThrow();
});

it("rolls back all imports on username collision and keeps short password exception explicit", async () => {
  const { roster } = await fixture();
  const before = auth.organization.directory("test");
  const bad = { ...roster, departments: [...roster.departments, { ...roster.departments[0], id: "new-dept" }], members: [...roster.members, { ...roster.members[1], id: "collision" }] };
  await expect(auth.organization.bulkImport(bad, password)).rejects.toThrow();
  expect(auth.organization.directory("test")).toEqual(before);
  await expect(auth.organization.bulkImport(roster, randomBytes(4).toString("hex"))).rejects.toThrow();
  await expect(auth.organization.bulkImport(roster, randomBytes(4).toString("hex"), { allowShortPassword: true })).resolves.toBeDefined();
});

it("denies admin routes to non-admin roles even for GET or HEAD", () => {
  expect(authorizeApiRequest("GET", "/api/v1/admin/organization", ["viewer"])).toBe(false);
  expect(authorizeApiRequest("HEAD", "/api/v1/admin/organization", ["researcher"])).toBe(false);
  expect(authorizeApiRequest("GET", "/api/v1/organization", ["viewer"])).toBe(true);
  expect(authorizeApiRequest("PATCH", "/api/v1/admin/members/member-1", ["org_admin"])).toBe(true);
});

it("rejects cross-tenant bindings and invalid placeholders and atomically rolls back a later insert failure", async () => {
  const { roster } = await fixture(); const before = auth.organization.directory("test");
  const otherTenant = { ...roster, tenantId: "other" };
  await expect(auth.organization.bulkImport(otherTenant, password)).rejects.toThrow();
  await expect(auth.organization.bulkImport({ ...roster, members: [{ ...roster.members[2], username: "占位岗位" }] }, password)).rejects.toThrow();
  const members = [{ ...roster.members[1], id: "new-member", username: "新的成员" }, { ...roster.members[1], id: "late-failure", username: "另一成员" }];
  db.exec("CREATE TRIGGER reject_late_member BEFORE INSERT ON organization_members WHEN NEW.id='late-failure' BEGIN SELECT RAISE(ABORT,'test failure'); END");
  await expect(auth.organization.bulkImport({ ...roster, members }, password)).rejects.toThrow();
  expect(db.prepare("SELECT id FROM user WHERE username=?").get("新的成员")).toBeUndefined();
  expect(auth.organization.directory("test")).toEqual(before);
});

it("handles unordered department trees, rejects cycles and denies placeholder roles or missing members", async () => {
  const { admin, roster } = await fixture(); const actor = { accountId: admin.id, tenantId: "test" };
  const departments = [{ ...roster.departments[0], id: "child", parentId: "parent" }, { ...roster.departments[0], id: "parent" }];
  await auth.organization.bulkImport({ ...roster, departments, members: [] }, password);
  expect(auth.organization.directory("test").departments).toHaveLength(3);
  await expect(auth.organization.bulkImport({ ...roster, departments: [{ ...departments[0], id: "cyclic", parentId: "cyclic" }], members: [] }, password)).rejects.toThrow();
  expect(() => auth.organization.updateMember(actor, "placeholder", { expectedVersion: 1, roles: ["org_admin"] })).toThrow();
  expect(() => auth.organization.updateMember(actor, "missing", { expectedVersion: 1, title: "unknown" })).toThrow();
  expect(() => auth.organization.updateDepartment(actor, "missing", { expectedVersion: 1, name: "unknown" })).toThrow();
  expect(db.prepare("SELECT count(*) AS n FROM organization_audit").get()?.n).toBeGreaterThan(0);
});
