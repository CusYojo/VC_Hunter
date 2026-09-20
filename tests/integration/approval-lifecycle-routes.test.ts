import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import { WorkspaceActivityRepository } from "@/repositories/workspace-activity";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), database: vi.fn() }));
vi.mock("@/security/workspace-session", () => ({ resolveWorkspaceIdentity: mocks.identity }));
vi.mock("@/db/app", () => ({ getAppDatabase: mocks.database }));
vi.mock("@/workbench/team", async () => { const { identityScope } = await import("@/security/identity-scope"); return { getCurrentUser: () => identityScope.getStore()?.user, loadTeamMembers: () => ["owner", "reviewer", "admin"].map(id => ({ id })) }; });
import { POST } from "@/app/api/v1/activity/[id]/lifecycle/route";
import { GET, POST as create } from "@/app/api/v1/activity/route";
import { PATCH as edit } from "@/app/api/v1/activity/[id]/edit/route";
import { PATCH as respond } from "@/app/api/v1/activity/[id]/route";
let db: DatabaseSync; let repository: WorkspaceActivityRepository; let id: string;
function identity(actor: string, roles = ["researcher"]) { mocks.identity.mockResolvedValue({ user: { id: actor, name: actor, role: "成员", capabilities: [] }, accountId: crypto.randomUUID(), tenantId: "org", roles }); }
function request(body: unknown, path = `/api/v1/activity/${id}/lifecycle`, method = "POST") { return new Request(`https://vc.example${path}`, { method, headers: { origin: "https://vc.example", "content-type": "application/json", "idempotency-key": "request-key" }, body: JSON.stringify(body) }); }
const context = () => ({ params: Promise.resolve({ id }) });
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BETTER_AUTH_URL", "https://vc.example");
  db = createDatabase(":memory:"); initializeDatabase(db); seedDemoData(db); mocks.database.mockReturnValue(db);
  repository = new WorkspaceActivityRepository(db, ["owner", "reviewer", "admin"]);
  id = repository.create({ kind: "approval", approvalType: "reimbursement", title: "报销", participantIds: ["reviewer"] }, "owner", "new").id;
  identity("owner");
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
it("requires session and the original applicant, including when the other caller is admin", async () => {
  mocks.identity.mockResolvedValue(null); expect((await POST(request({ action: "withdraw", expectedVersion: 1 }), context())).status).toBe(401);
  for (const [actor, roles] of [["reviewer", ["researcher"]], ["admin", ["org_admin"]]] as const) {
    identity(actor, [...roles]); expect((await POST(request({ action: "withdraw", expectedVersion: 1 }), context())).status).toBe(403);
  }
  identity("owner", ["viewer"]); const response = await POST(request({ action: "withdraw", expectedVersion: 1 }), context());
  expect(response.status).toBe(200); expect((await response.json()).data).toMatchObject({ status: "withdrawn", approvalType: "reimbursement", version: 2 });
  expect((await POST(request({ action: "withdraw", expectedVersion: 1 }), context())).status).toBe(200);
});
it("rejects invalid transitions, stale versions and forged lifecycle fields", async () => {
  expect((await POST(request({ action: "complete", expectedVersion: 1 }), context())).status).toBe(400);
  expect((await POST(request({ action: "withdraw", expectedVersion: 100 }), context())).status).toBe(409);
  expect((await POST(request({ action: "withdraw", expectedVersion: 1, actorId: "admin" }), context())).status).toBe(400);
  expect((await POST(request({ action: "archive", expectedVersion: 1 }), context())).status).toBe(400);
  const missing = await POST(request({ action: "withdraw", expectedVersion: 1 }, "/api/v1/activity/missing/lifecycle"), { params: Promise.resolve({ id: "missing" }) });
  expect(missing.status).toBe(404);
  const huge = request({ action: "withdraw", expectedVersion: 1, note: "x".repeat(2000) });
  expect((await POST(huge, context())).status).toBe(413);
});
it("keeps historical reads scoped and validates list filters", async () => {
  await POST(request({ action: "withdraw", expectedVersion: 1 }), context());
  const list = async (query: string) => GET(new Request(`https://vc.example/api/v1/activity${query}`));
  expect((await (await list("?status=current")).json()).data).toEqual([]);
  expect((await (await list("?status=withdrawn")).json()).data).toHaveLength(1);
  expect((await (await list(`?activity=${id}`)).json()).data[0]).toMatchObject({ status: "withdrawn" });
  identity("admin", ["org_admin"]); expect((await (await list(`?activity=${id}`)).json()).data).toEqual([]);
  expect((await list("?status=invalid")).status).toBe(400); expect((await list("?actorId=owner")).status).toBe(400);
});
it("maps the frozen-state guard on existing edit and response endpoints and rejects type bypass", async () => {
  await POST(request({ action: "withdraw", expectedVersion: 1 }), context());
  expect((await edit(request({ kind: "approval", title: "edited", participantIds: ["reviewer"], expectedVersion: 2 }, `/api/v1/activity/${id}/edit`, "PATCH"), context())).status).toBe(409);
  identity("reviewer", ["investment_manager"]); expect((await respond(request({ action: "approved", expectedVersion: 2 }, `/api/v1/activity/${id}`, "PATCH"), context())).status).toBe(409);
  identity("owner"); const invalid = await create(request({ kind: "task", title: "bypass", approvalType: "reimbursement" }, "/api/v1/activity"));
  expect(invalid.status).toBe(400);
});
it("rejects malformed JSON and masks unexpected storage failures", async () => {
  const broken = new Request(`https://vc.example/api/v1/activity/${id}/lifecycle`, { method: "POST", headers: { origin: "https://vc.example", "content-type": "application/json" }, body: "{" });
  expect((await POST(broken, context())).status).toBe(400);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.database.mockImplementationOnce(() => { throw new Error("private database path"); });
  const response = await POST(request({ action: "withdraw", expectedVersion: 1 }), context());
  expect(response.status).toBe(500); expect(await response.text()).not.toContain("private database path");
  log.mockRestore();
});
it("archives an approved request immediately through the authenticated lifecycle route", async () => {
  identity("reviewer", ["viewer"]);
  const approved = await respond(request({ action: "approved", expectedVersion: 1 }, `/api/v1/activity/${id}`, "PATCH"), context());
  expect(approved.status).toBe(200);
  identity("owner");
  const archived = await POST(request({ action: "complete", expectedVersion: 2, archiveNow: true }), context());
  expect(archived.status).toBe(200);
  expect((await archived.json()).data).toMatchObject({ status: "archived", version: 3, archivedAt: expect.any(String) });
  expect((await POST(request({ action: "complete", expectedVersion: 2, archiveNow: true }), context())).status).toBe(200);
});
it("marks only the assigned recipient as having viewed the approval", async () => {
  const { POST: view } = await import("@/app/api/v1/activity/[id]/view/route");
  const viewRequest = () => new Request(`https://vc.example/api/v1/activity/${id}/view`, { method: "POST", headers: { origin: "https://vc.example" } });
  identity("owner"); expect((await view(viewRequest(), context())).status).toBe(403);
  identity("reviewer", ["viewer"]); const first = await view(viewRequest(), context()); expect(first.status).toBe(200);
  const item = (await first.json()).data; expect(item.responses[0].viewedAt).toEqual(expect.any(String)); expect(item.version).toBe(1);
  expect((await view(viewRequest(), context())).status).toBe(200);
});
it("permits only an org administrator to perform immediate archival for another applicant", async () => {
  identity("reviewer", ["investment_manager"]); await respond(request({ action: "approved", expectedVersion: 1 }, `/api/v1/activity/${id}`, "PATCH"), context());
  identity("admin", ["investment_manager"]); expect((await POST(request({ action: "complete", expectedVersion: 2, archiveNow: true }), context())).status).toBe(403);
  identity("admin", ["org_admin"]); const result = await POST(request({ action: "complete", expectedVersion: 2, archiveNow: true }), context());
  expect(result.status).toBe(200); expect((await result.json()).data.status).toBe("archived");
});
