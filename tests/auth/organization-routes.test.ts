// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAuthService } from "@/auth/service";
const state = vi.hoisted(() => ({ service: null as ReturnType<typeof createAuthService> | null }));
vi.mock("@/auth/server", () => ({ getAuthService: () => state.service, requireSession: (headers: Headers) => state.service!.requireSession(headers) }));
import { GET as adminGET } from "@/app/api/v1/admin/organization/route";
import { GET as publicGET } from "@/app/api/v1/organization/route";
import { PATCH } from "@/app/api/v1/admin/members/[id]/route";

const origin = "http://localhost:3199";
let db: DatabaseSync; let adminCookie: string; let viewerCookie: string;
beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BETTER_AUTH_URL", origin); vi.stubEnv("VC_HUNTER_CURRENT_TENANT_ID", "test");
  db = new DatabaseSync(":memory:"); state.service = createAuthService({ database: db, baseURL: origin, secret: randomBytes(32).toString("hex"), rateLimit: false }); await state.service.migrate();
  const password = randomBytes(24).toString("hex");
  await state.service.invite({ username: "admin", name: "Admin", password, teamUserId: "admin", tenantId: "test", roles: ["org_admin"] });
  await state.service.organization.bulkImport({ tenantId: "test", departments: [], members: [{ id: "viewer", name: "普通成员", username: "普通成员", title: "总监", departmentId: null, isPlaceholder: false, sourceNotes: "private-source-note" }] }, password);
  async function cookie(username: string) {
    const response = await state.service!.auth.handler(new Request(`${origin}/api/auth/sign-in/username`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ username, password }) }));
    return response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  }
  adminCookie = await cookie("admin"); viewerCookie = await cookie("普通成员");
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); });

it("enforces real session/private roles before organization reads or mutations", async () => {
  expect((await adminGET(new Request(`${origin}/api/v1/admin/organization`))).status).toBe(401);
  expect((await adminGET(new Request(`${origin}/api/v1/admin/organization`, { headers: { cookie: viewerCookie } }))).status).toBe(403);
  const safe = await publicGET(new Request(`${origin}/api/v1/organization`, { headers: { cookie: viewerCookie } }));
  expect(safe.status).toBe(200); expect(await safe.text()).not.toMatch(/private-source-note|username|accountId|roles|wechat|email|phone/);
  const full = await adminGET(new Request(`${origin}/api/v1/admin/organization`, { headers: { cookie: adminCookie } }));
  expect(full.status).toBe(200); expect(await full.text()).toContain("private-source-note");
  const request = (cookie: string, source: string) => new Request(`${origin}/api/v1/admin/members/viewer`, { method: "PATCH", headers: { cookie, origin: source, "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: 1, title: "更新职务" }) });
  expect((await PATCH(request(viewerCookie, origin), { params: Promise.resolve({ id: "viewer" }) })).status).toBe(403);
  expect((await PATCH(request(adminCookie, "https://evil.invalid"), { params: Promise.resolve({ id: "viewer" }) })).status).toBe(403);
  expect((await PATCH(request(adminCookie, origin), { params: Promise.resolve({ id: "viewer" }) })).status).toBe(200);
});
