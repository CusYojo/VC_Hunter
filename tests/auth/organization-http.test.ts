// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createAuthService } from "@/auth/service";
import { handleOrganizationRequest } from "@/organization/http";
let db: DatabaseSync; let auth: ReturnType<typeof createAuthService>; let accountId: string;
const origin = "http://localhost:3199";
beforeEach(async () => {
  db = new DatabaseSync(":memory:"); auth = createAuthService({ database: db, secret: randomBytes(32).toString("hex"), baseURL: origin, rateLimit: false }); await auth.migrate();
  accountId = (await auth.invite({ username: "testadmin", name: "Admin", password: randomBytes(24).toString("hex"), teamUserId: "admin", tenantId: "test", roles: ["org_admin"] })).id;
});
afterEach(() => db.close());
it("returns 401 anonymously, denies non-admin full directory and maps schema/version errors safely", async () => {
  const request = () => new Request(`${origin}/api/v1/admin/organization`);
  expect((await handleOrganizationRequest(request(), auth.organization, null, "admin-directory")).status).toBe(401);
  expect((await handleOrganizationRequest(request(), auth.organization, { accountId: "unknown", tenantId: "test" }, "admin-directory")).status).toBe(403);
  const actor = { accountId, tenantId: "test" };
  expect((await handleOrganizationRequest(request(), auth.organization, actor, "admin-directory")).status).toBe(200);
  const bad = new Request(`${origin}/api/v1/admin/departments`, { method: "POST", body: JSON.stringify({ name: "private-contact", roles: ["org_admin"] }) });
  const response = await handleOrganizationRequest(bad, auth.organization, actor, "create-department");
  expect(response.status).toBe(400); expect(await response.text()).not.toContain("private-contact");
  const department = auth.organization.createDepartment(actor, { name: "测试部", parentId: null, expectedHeadcount: null, notes: "", sortOrder: 0 });
  const stale = new Request(`${origin}/api/v1/admin/departments/${department.id}`, { method: "PATCH", body: JSON.stringify({ expectedVersion: 10, name: "更新部" }) });
  expect((await handleOrganizationRequest(stale, auth.organization, actor, "update-department", department.id)).status).toBe(409);
});

it("permits two-character pure Han usernames but still rejects two-character mixed/ASCII values", async () => {
  const password = randomBytes(24).toString("hex");
  await auth.invite({ username: "李明", name: "李明", password, teamUserId: "two-han", tenantId: "test", roles: ["viewer"] });
  const response = await auth.auth.handler(new Request(`${origin}/api/auth/sign-in/username`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ username: "李明", password }) }));
  expect(response.status).toBe(200);
  for (const username of ["李", "ab", "李a"]) await expect(auth.invite({ username, name: "invalid", password, teamUserId: "invalid", tenantId: "test", roles: ["viewer"] })).rejects.toThrow();
});

it("returns safe public data and refuses oversized or absent JSON bodies", async () => {
  const actor = { accountId, tenantId: "test" };
  const request = new Request(`${origin}/api/v1/organization`);
  const response = await handleOrganizationRequest(request, auth.organization, actor, "directory");
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
  const huge = new Request(`${origin}/api/v1/admin/departments`, { method: "POST", body: "x".repeat(33_000) });
  expect((await handleOrganizationRequest(huge, auth.organization, actor, "create-department")).status).toBe(413);
  const empty = new Request(`${origin}/api/v1/admin/departments`, { method: "POST" });
  expect((await handleOrganizationRequest(empty, auth.organization, actor, "create-department")).status).toBe(400);
  const valid = new Request(`${origin}/api/v1/admin/departments`, { method: "POST", body: JSON.stringify({ name: "投资部", parentId: null, expectedHeadcount: 3, notes: "", sortOrder: 0 }) });
  expect((await handleOrganizationRequest(valid, auth.organization, actor, "create-department")).status).toBe(201);
});
