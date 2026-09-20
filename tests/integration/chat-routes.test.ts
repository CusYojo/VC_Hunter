import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), database: vi.fn(), gateway: vi.fn(), generate: vi.fn() }));
vi.mock("@/security/workspace-session", () => ({ resolveWorkspaceIdentity: mocks.identity }));
vi.mock("@/db/app", () => ({ getAppDatabase: mocks.database }));
vi.mock("@/ai/personal-model", async original => ({ ...await original<typeof import("@/ai/personal-model")>(), createPersonalModelGateway: mocks.gateway }));
import { GET, POST } from "@/app/api/v1/ai/conversations/route";
import { GET as detailGET } from "@/app/api/v1/ai/conversations/[id]/route";
import { POST as messagePOST } from "@/app/api/v1/ai/conversations/[id]/messages/route";
import { PersonalAIRequiredError } from "@/ai/personal-model";
let db: DatabaseSync;
let accountId: string;
let id: string;
const body = { prompt: "工作计划", skill: "summary", consent: true, useKnowledge: false };
function request(path: string, payload?: unknown) {
  return new Request(`http://localhost/api/v1/ai/conversations${path}`, payload === undefined ? {} : { method: "POST", headers: { origin: "http://localhost", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(payload) });
}
function params() { return { params: Promise.resolve({ id }) }; }
function identity(account = accountId, tenantId = "tenant") { mocks.identity.mockResolvedValue({ user: { id: "shared-team-id" }, accountId: account, tenantId, roles: ["viewer"] }); }
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BETTER_AUTH_URL", "http://localhost");
  db = createDatabase(":memory:"); initializeDatabase(db); mocks.database.mockReturnValue(db);
  accountId = crypto.randomUUID(); id = crypto.randomUUID(); identity();
  mocks.generate.mockResolvedValue({ text: "工作计划已整理。", lineage: { actualModel: "fixture", usage: {} } });
  mocks.gateway.mockReturnValue({ provider: "openai", model: "fixture", generateText: mocks.generate });
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.resetAllMocks(); });

it("protects conversations and binds personal model to authenticated account", async () => {
  const created = await POST(request("", { id })); expect(created.status).toBe(200);
  expect(created.headers.get("cache-control")).toContain("no-store");
  const response = await messagePOST(request(`/${id}/messages`, body), params());
  expect(response.status).toBe(200); expect((await response.json()).data.status).toBe("succeeded");
  expect(mocks.gateway).toHaveBeenCalledWith(db, expect.objectContaining({ accountId, tenantId: "tenant" }));
  expect((await (await detailGET(request(`/${id}`), params())).json()).data.turns).toHaveLength(1);
  for (const [account, tenant] of [[crypto.randomUUID(), "tenant"], [accountId, "different"]]) {
    identity(account, tenant);
    expect((await (await GET(request(""))).json()).data).toEqual([]);
    expect((await detailGET(request(`/${id}`), params())).status).toBe(404);
    expect((await messagePOST(request(`/${id}/messages`, body), params())).status).toBe(404);
  }
  expect(mocks.generate).toHaveBeenCalledOnce();
});

it("blocks missing authentication, cross-origin mutation and forged identities", async () => {
  mocks.identity.mockResolvedValue(null);
  expect((await GET(request(""))).status).toBe(401);
  expect((await detailGET(request(`/${id}`), params())).status).toBe(401);
  expect((await messagePOST(request(`/${id}/messages`, body), params())).status).toBe(401);
  identity(); const cross = request("", { id }); cross.headers.set("origin", "https://evil.test");
  expect((await POST(cross)).status).toBe(403);
  expect((await POST(request("", { id, accountId: "other" }))).status).toBe(400);
});

it("validates requests, limits bodies and persists configuration failure for retry", async () => {
  await POST(request("", { id }));
  expect((await messagePOST(request(`/${id}/messages`, { ...body, consent: false }), params())).status).toBe(400);
  expect((await messagePOST(request(`/${id}/messages`, { ...body, useKnowledge: true }), params())).status).toBe(400);
  expect((await messagePOST(request(`/${id}/messages`, { ...body, context: "x".repeat(310000) }), params())).status).toBe(413);
  mocks.gateway.mockImplementation(() => { throw new PersonalAIRequiredError(); });
  const result = await messagePOST(request(`/${id}/messages`, body), params());
  expect(result.status).toBe(502); expect((await result.json()).data.error).toContain("自己的 AI API");
  expect((await POST(request("", { id: "x".repeat(1100) }))).status).toBe(413);
});

it("rate-limits paid message generation independently of regular writes", async () => {
  await POST(request("", { id }));
  for (let i = 0; i < 5; i++) expect((await messagePOST(request(`/${id}/messages`, body), params())).status).toBe(200);
  expect((await messagePOST(request(`/${id}/messages`, body), params())).status).toBe(429);
  expect(mocks.generate).toHaveBeenCalledTimes(5);
});
