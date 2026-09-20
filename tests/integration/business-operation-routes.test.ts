import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), database: vi.fn() }));
vi.mock("@/security/workspace-session", () => ({ resolveWorkspaceIdentity: mocks.identity }));
vi.mock("@/db/app", () => ({ getAppDatabase: mocks.database }));
import { GET, POST } from "@/app/api/v1/operations/[kind]/route";
import { PATCH } from "@/app/api/v1/operations/[kind]/[id]/route";
let db: DatabaseSync;
const value = { name: "测试联系人", status: "active", data: { contact: "office@example.test" } };
const context = { params: Promise.resolve({ kind: "contact" }) };
function identity(role = "investment_manager", tenantId = "org-a") { mocks.identity.mockResolvedValue({ user: { id: "u1", name: "用户" }, accountId: crypto.randomUUID(), tenantId, roles: [role] }); }
function request(method = "GET", body?: unknown, path = "contact") { return new Request(`http://localhost/api/v1/operations/${path}`, { method, headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
beforeEach(() => { vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BETTER_AUTH_URL", "http://localhost"); db = createDatabase(":memory:"); initializeDatabase(db); seedDemoData(db); mocks.database.mockReturnValue(db); identity(); });
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("business operation APIs", () => {
  it("authenticates reads and prevents viewer writes", async () => {
    mocks.identity.mockResolvedValue(null); expect((await GET(request(), context)).status).toBe(401);
    identity("viewer"); expect((await GET(request(), context)).status).toBe(200); expect((await POST(request("POST", value), context)).status).toBe(403);
  });
  it("persists, updates, isolates tenants and exposes conflict errors", async () => {
    const created = await POST(request("POST", value), context); expect(created.status).toBe(201);
    const record = (await created.json()).data;
    expect((await (await GET(request(), context)).json()).data.records).toHaveLength(1);
    const patchContext = { params: Promise.resolve({ kind: "contact", id: record.id }) };
    expect((await PATCH(request("PATCH", { ...value, name: "更新联系人", version: 1 }, `contact/${record.id}`), patchContext)).status).toBe(200);
    expect((await PATCH(request("PATCH", { ...value, version: 1 }, `contact/${record.id}`), patchContext)).status).toBe(409);
    identity("investment_manager", "org-b"); expect((await (await GET(request(), context)).json()).data.records).toHaveLength(0);
    expect((await PATCH(request("PATCH", { version: 2, archived: true }, `contact/${record.id}`), patchContext)).status).toBe(404);
  });
  it("rejects unsafe writes and masks implementation errors", async () => {
    expect((await POST(request("POST", { ...value, tenantId: "foreign" }), context)).status).toBe(400);
    expect((await POST(new Request("http://localhost/api/v1/operations/contact", { method: "POST", headers: { origin: "http://evil.test" }, body: "{}" }), context)).status).toBe(403);
    mocks.database.mockImplementationOnce(() => { throw new Error("secret /private/file"); });
    const result = await GET(request(), context); expect(result.status).toBe(500); expect(JSON.stringify(await result.json())).not.toContain("/private/file");
  });
});
