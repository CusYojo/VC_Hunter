import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), database: vi.fn() }));
vi.mock("@/security/workspace-session", () => ({ resolveWorkspaceIdentity: mocks.identity }));
vi.mock("@/db/app", () => ({ getAppDatabase: mocks.database }));
import { GET, PUT, DELETE } from "@/app/api/v1/settings/ai/route";
let db: DatabaseSync;
const url = "http://localhost/api/v1/settings/ai";
let aliceId: string;
function identity(accountId: string, tenantId = "organization-one", role = "viewer") {
  mocks.identity.mockResolvedValue({ user: { id: "shared-team-id", name: "成员" }, accountId, tenantId, roles: [role] });
}
const input = { provider: "deepseek", model: "deepseek-chat", apiKey: "test-private-api-key" };
function request(method = "PUT", body: unknown = input, origin = "http://localhost") { return new Request(url, { method, headers: { origin }, body: JSON.stringify(body) }); }
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BETTER_AUTH_URL", "http://localhost");
  vi.stubEnv("VC_HUNTER_AI_ENCRYPTION_KEY", Buffer.alloc(32, 2).toString("base64"));
  db = createDatabase(":memory:"); initializeDatabase(db); mocks.database.mockReturnValue(db);
  aliceId = crypto.randomUUID(); identity(aliceId);
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("personal AI settings authenticated route", () => {
  it("lets all members manage only their own configuration and remove it", async () => {
    for (const role of ["org_admin", "investment_manager", "researcher", "compliance_reviewer", "viewer"]) {
      identity(aliceId, "organization-one", role);
      expect((await PUT(request())).status).toBe(200);
    }
    const response = await GET(new Request(url));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ data: { activeProvider: "deepseek" } });
    identity(crypto.randomUUID());
    expect(await (await GET(new Request(url))).json()).toMatchObject({ data: { activeProvider: null } });
    expect((await DELETE(request("DELETE", { provider: "deepseek" }))).status).toBe(200);
    identity(aliceId, "organization-two");
    expect(await (await GET(new Request(url))).json()).toMatchObject({ data: { activeProvider: null } });
    identity(aliceId);
    expect(await (await DELETE(request("DELETE", { provider: "deepseek" }))).json()).toMatchObject({ data: { activeProvider: null } });
  });
  it("requires login, same-origin mutations and server-owned identities", async () => {
    mocks.identity.mockResolvedValue(null);
    expect((await GET(new Request(url))).status).toBe(401);
    expect((await PUT(request())).status).toBe(401);
    identity(aliceId);
    expect((await PUT(request("PUT", input, "https://attacker.example"))).status).toBe(403);
    const spoofed = request(); spoofed.headers.set("x-user-id", "other-account");
    expect((await PUT(spoofed)).status).toBe(400);
    expect((await PUT(request("PUT", { ...input, accountId: "other-account" }))).status).toBe(400);
  });
  it("masks internal errors without credentials or filesystem details", async () => {
    mocks.database.mockImplementationOnce(() => { throw new Error("test-private-api-key /secret/path"); });
    const response = await GET(new Request(url));
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).not.toContain("test-private-api-key"); expect(body).not.toContain("/secret/path");
  });
});
