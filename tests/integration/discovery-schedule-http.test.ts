import { afterEach, beforeEach, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { identityScope, type WorkspaceIdentity } from "@/security/identity-scope";
import { authorizeApiRequest } from "@/security/api-policy";
import { handleDiscoverySchedule } from "@/services/discovery-schedule-http";
let db: DatabaseSync;
beforeEach(() => { db = createDatabase(":memory:"); initializeDatabase(db); });
afterEach(() => db.close());
const identity = (role: string): WorkspaceIdentity => ({ accountId: "account-admin", tenantId: "organization", roles: [role], user: { id: "team-admin", name: "管理员", role, capabilities: [] } });
const request = (method = "GET", body?: unknown) => new Request("https://example.test/api/v1/discovery/schedule", { method, ...(body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) });
it("requires authentication and permits members to read without write access", async () => {
  expect((await handleDiscoverySchedule(request(), db)).status).toBe(401);
  const member = identity("investment_manager");
  expect((await identityScope.run(member, () => handleDiscoverySchedule(request(), db))).status).toBe(200);
  expect((await identityScope.run(member, () => handleDiscoverySchedule(request("PATCH", { enabled: true, version: 1 }), db))).status).toBe(403);
  expect(authorizeApiRequest("PATCH", "/api/v1/discovery/schedule", member.roles)).toBe(false);
  expect(authorizeApiRequest("PATCH", "/api/v1/discovery/schedule", ["org_admin"])).toBe(true);
});
it("stores only an administrator's identity in the audited update and detects version conflicts", async () => {
  const admin = identity("org_admin");
  const response = await identityScope.run(admin, () => handleDiscoverySchedule(request("PATCH", { enabled: true, version: 1 }), db));
  expect(response.status).toBe(200);
  expect((await response.json()).data).toMatchObject({ enabled: true, version: 2, timezone: "Asia/Shanghai", times: ["10:00", "14:00"] });
  expect(db.prepare("SELECT actor_account_id,enabled FROM discovery_schedule_audit").get()).toMatchObject({ actor_account_id: admin.accountId, enabled: 1 });
  expect((await identityScope.run(admin, () => handleDiscoverySchedule(request("PATCH", { enabled: false, version: 1 }), db))).status).toBe(409);
});
it("rejects role spoofing, malformed JSON, and oversized settings bodies", async () => {
  const admin = identity("org_admin");
  expect((await identityScope.run(admin, () => handleDiscoverySchedule(request("PATCH", { enabled: true, version: 1, actorAccountId: "someone-else" }), db))).status).toBe(400);
  const malformed = new Request("https://example.test/api/v1/discovery/schedule", { method: "PATCH", body: "{" });
  expect((await identityScope.run(admin, () => handleDiscoverySchedule(malformed, db))).status).toBe(400);
  const large = request("PATCH", { enabled: true, version: 1, padding: "x".repeat(5000) });
  expect((await identityScope.run(admin, () => handleDiscoverySchedule(large, db))).status).toBe(400);
  expect(db.prepare("SELECT COUNT(*) AS n FROM discovery_schedule_audit").get()).toMatchObject({ n: 0 });
});
