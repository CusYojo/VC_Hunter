import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), database: vi.fn() }));
vi.mock("@/security/workspace-session", () => ({ resolveWorkspaceIdentity: mocks.identity }));
vi.mock("@/db/app", () => ({ getAppDatabase: mocks.database }));
import { PATCH } from "@/app/api/v1/candidates/order/route";
import { GET } from "@/app/api/v1/candidates/route";
let db: DatabaseSync;
const body = { move: { id: "one", expectedVersion: 1, direction: "down" } };
function identity(role = "org_admin") { mocks.identity.mockResolvedValue({ user: { id: "admin-member" }, accountId: "admin-account", tenantId: "org", roles: [role] }); }
function request(payload: unknown = body, key = "move", origin = "http://localhost") { return new Request("http://localhost/api/v1/candidates/order", { method: "PATCH", headers: { origin, "idempotency-key": key, "content-type": "application/json" }, body: JSON.stringify(payload) }); }
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BETTER_AUTH_URL", "http://localhost");
  db=createDatabase(":memory:"); initializeDatabase(db); mocks.database.mockReturnValue(db); identity();
  for (const id of ["one","two"]) {
    db.prepare("INSERT INTO web_search_leads(id,url,title,highlights_json,first_seen_at,last_seen_at,status) VALUES (?,?,?,'[]',?,?,'discovered')").run(id,`https://example.test/${id}`,id,new Date().toISOString(),new Date().toISOString());
    db.prepare("INSERT INTO project_candidates(id,lead_id,company_name,track,investor_names_json,signal_type,summary,confidence,status,model,prompt_version,created_at,updated_at) VALUES (?,?,?,'AI','[]','funding','摘要',0.9,'pending_review','fixture','v1',?,?)").run(id,id,id,new Date().toISOString(),new Date().toISOString());
  }
  db.prepare("UPDATE web_search_leads SET published_at=?,publication_verified_at=?").run(new Date().toISOString(),new Date().toISOString());
  db.prepare("UPDATE project_candidates SET queue_rank=0 WHERE id='one'").run();
  db.prepare("UPDATE project_candidates SET queue_rank=1 WHERE id='two'").run();
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
it("permits only authenticated administrators from the correct origin to change order", async () => {
  mocks.identity.mockResolvedValue(null); expect((await PATCH(request())).status).toBe(401);
  identity("investment_manager"); expect((await PATCH(request())).status).toBe(403);
  identity(); expect((await PATCH(request(body,"cross","https://evil.test"))).status).toBe(403);
  expect(db.prepare("SELECT review_version FROM project_candidates WHERE id='one'").get()?.review_version).toBe(1);
  const saved = await PATCH(request()); expect(saved.status).toBe(200);
  expect((await saved.json()).data.items).toEqual([{id:"two",version:2,queueRank:0},{id:"one",version:2,queueRank:1}]);
  expect((await PATCH(request())).status).toBe(200);
  expect((await PATCH(request({move:{...body.move,direction:"up"}},"move"))).status).toBe(409);
});
it("rejects identity injection and invalid dates, while serving only today's queue by default", async () => {
  expect((await PATCH(request({...body,accountId:"forged"}))).status).toBe(400);
  expect((await PATCH(request(body,""))).status).toBe(400);
  expect((await GET(new Request("http://localhost/api/v1/candidates?date=2026-02-30"))).status).toBe(400);
  expect((await GET(new Request("http://localhost/api/v1/candidates?tenantId=other"))).status).toBe(400);
  const result = await GET(new Request("http://localhost/api/v1/candidates"));
  expect(result.status).toBe(200); expect((await result.json()).data.total).toBe(2);
  expect(result.headers.get("cache-control")).toContain("no-store");
});
