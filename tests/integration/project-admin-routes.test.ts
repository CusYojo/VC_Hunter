import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), database: vi.fn(), directory: vi.fn() }));
vi.mock("@/auth/server", () => ({ getAuthService: () => ({ organization: { directory: mocks.directory } }) }));
vi.mock("@/security/workspace-session", () => ({ resolveWorkspaceIdentity: mocks.identity }));
vi.mock("@/db/app", () => ({ getAppDatabase: mocks.database, getAppRepository: vi.fn() }));
import { POST } from "@/app/api/v1/projects/route";
import { PATCH } from "@/app/api/v1/projects/[id]/route";
let db: DatabaseSync;
const input = { name: "新建真实项目", track: "AI", executiveSummary: "管理员录入内容" };
function identify(roles = ["org_admin"]) { mocks.identity.mockResolvedValue({ user: { id: "admin", name: "任意管理员姓名" }, accountId: crypto.randomUUID(), tenantId: "org-a", roles }); }
function request(method: string, body: unknown, id = "", origin = "http://localhost") { return new Request(`http://localhost/api/v1/projects${id ? `/${id}` : ""}`, { method, headers: { origin, "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(body) }); }
beforeEach(() => { vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BETTER_AUTH_URL", "http://localhost"); db = createDatabase(":memory:"); initializeDatabase(db); seedDemoData(db); mocks.database.mockReturnValue(db);
  mocks.directory.mockReturnValue({ members: [
    { id: "admin", name: "任意管理员姓名", active: true, accountId: "admin-account", isPlaceholder: false },
    { id: "colleague", name: "当前租户同事", active: true, accountId: "colleague-account", isPlaceholder: false },
    { id: "inactive", name: "已停用同事", active: false, accountId: "inactive-account", isPlaceholder: false },
  ], departments: [] }); identify(); });
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("administrator project routes", () => {
  it("creates and edits with version checks for an authenticated administrator", async () => {
    const created = await POST(request("POST", input)); expect(created.status).toBe(201);
    const project = (await created.json()).data;
    expect(mocks.directory).toHaveBeenCalledWith("org-a");
    expect(db.prepare("SELECT recipient_id,actor_id,kind,project_id FROM member_notifications").all()).toEqual([
      { recipient_id: "colleague", actor_id: "admin", kind: "project_created", project_id: project.id },
    ]);
    const context = { params: Promise.resolve({ id: project.id }) };
    const changed = await PATCH(request("PATCH", { expectedVersion: 1, name: "正式项目" }, project.id), context);
    expect(changed.status).toBe(200); expect((await changed.json()).data.name).toBe("正式项目");
    expect((await PATCH(request("PATCH", { expectedVersion: 1, name: "过期编辑" }, project.id), context)).status).toBe(409);
  });
  it("denies ordinary writers, viewers, impersonation and cross-origin writes", async () => {
    for (const roles of [["investment_manager"], ["viewer"]]) { identify(roles); expect((await POST(request("POST", input))).status).toBe(403); }
    identify(); expect((await POST(request("POST", input, "", "http://evil.test"))).status).toBe(403);
    expect((await POST(request("POST", { ...input, tenantId: "other", owner: "伪造" }))).status).toBe(400);
    mocks.identity.mockResolvedValue(null); expect((await POST(request("POST", input))).status).toBe(401);
  });
  it("masks storage failures and rejects an oversized untrusted body", async () => {
    mocks.database.mockImplementationOnce(() => { throw new Error("secret /private/storage"); });
    const failed = await POST(request("POST", input)); expect(failed.status).toBe(500); expect(await failed.text()).not.toContain("/private/storage");
    expect((await POST(request("POST", { ...input, executiveSummary: "x".repeat(200_000) }))).status).toBe(413);
  });
});
