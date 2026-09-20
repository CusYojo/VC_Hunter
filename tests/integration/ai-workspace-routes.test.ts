import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), database: vi.fn(), gateway: vi.fn(), generate: vi.fn() }));
vi.mock("@/security/workspace-session", () => ({ resolveWorkspaceIdentity: mocks.identity }));
vi.mock("@/db/app", () => ({ getAppDatabase: mocks.database }));
vi.mock("@/ai/personal-model", async (original) => ({ ...await original<typeof import("@/ai/personal-model")>(), createPersonalModelGateway: mocks.gateway }));
import { GET as runsGET, POST as runsPOST } from "@/app/api/v1/ai/runs/route";
import { GET as templatesGET, POST as templatesPOST, DELETE as templatesDELETE } from "@/app/api/v1/ai/templates/route";
import { POST as testPOST } from "@/app/api/v1/settings/ai/test/route";
import { POST as extractPOST } from "@/app/api/v1/ai/extract/route";
let db: DatabaseSync;
let alice: string;
const payload = { prompt: "核验会议纪要", context: "这是会议内容", skill: "minutes", consent: true };
const result = { text: "已生成会议纪要", lineage: { actualModel: "test-model", usage: { inputTokens: 10, outputTokens: 5 } } };
function identity(accountId: string, tenantId = "tenant-a") { mocks.identity.mockResolvedValue({ user: { id: "same-team-user" }, accountId, tenantId, roles: ["viewer"] }); }
function post(path: string, body: unknown, key = crypto.randomUUID(), method = "POST") { return new Request(`http://localhost${path}`, { method, headers: { origin: "http://localhost", "idempotency-key": key }, body: JSON.stringify(body) }); }
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BETTER_AUTH_URL", "http://localhost");
  db = createDatabase(":memory:"); initializeDatabase(db); mocks.database.mockReturnValue(db);
  alice = crypto.randomUUID(); identity(alice);
  mocks.generate.mockResolvedValue(result); mocks.gateway.mockReturnValue({ provider: "openai", model: "test-model", generateText: mocks.generate });
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.resetAllMocks(); });
describe("personal AI workspace routes", () => {
  it("binds model execution and history to the actual account and tenant", async () => {
    const response = await runsPOST(post("/api/v1/ai/runs", payload));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.gateway).toHaveBeenCalledWith(db, expect.objectContaining({ accountId: alice, tenantId: "tenant-a" }));
    const saved = (await response.json()).data;
    expect(saved).toMatchObject({ output: result.text, status: "succeeded" });
    expect(JSON.stringify(saved)).not.toContain("accountId");
    for (const [account, tenant] of [[crypto.randomUUID(), "tenant-a"], [alice, "tenant-b"]]) {
      identity(account, tenant);
      expect((await (await runsGET(new Request("http://localhost/api/v1/ai/runs"))).json()).data).toEqual([]);
    }
  });
  it("deduplicates in-flight same-key requests and rejects another running task", async () => {
    let complete!: (value: typeof result) => void;
    mocks.generate.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const first = runsPOST(post("/api/v1/ai/runs", payload, "shared-key"));
    await vi.waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(1));
    // A second server process must also be prevented by the database constraint.
    expect(() => db.prepare(`INSERT INTO personal_ai_runs (id,tenant_id,account_id,request_key,payload_hash,prompt,context,skill,provider,model,status,created_at,updated_at)
      SELECT 'parallel-run',tenant_id,account_id,'parallel-key',payload_hash,prompt,context,skill,provider,model,'running',created_at,updated_at FROM personal_ai_runs WHERE request_key='shared-key'`).run()).toThrow();
    const repeat = await runsPOST(post("/api/v1/ai/runs", payload, "shared-key"));
    expect((await repeat.json()).data.status).toBe("running");
    const conflict = await runsPOST(post("/api/v1/ai/runs", payload, "different-key"));
    expect(conflict.status).toBe(409);
    complete(result); expect((await first).status).toBe(200);
    expect((await runsPOST(post("/api/v1/ai/runs", payload, "shared-key"))).status).toBe(200);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });
  it("requires login, consent and rejects identity or endpoint injection", async () => {
    for (const body of [{ ...payload, accountId: "other" }, { ...payload, baseUrl: "http://127.0.0.1" }, { ...payload, consent: false }]) {
      expect((await runsPOST(post("/api/v1/ai/runs", body))).status).toBe(400);
    }
    expect(mocks.generate).not.toHaveBeenCalled(); mocks.identity.mockResolvedValue(null);
    expect((await runsGET(new Request("http://localhost/api/v1/ai/runs"))).status).toBe(401);
    expect((await testPOST(post("/api/v1/settings/ai/test", {}))).status).toBe(401);
    expect((await extractPOST(post("/api/v1/ai/extract", {}))).status).toBe(401);
  });
  it("isolates templates and prevents cross-account modification or deletion", async () => {
    const created = await templatesPOST(post("/api/v1/ai/templates", { name: "私人助手", instructions: "私人说明" }));
    const template = (await created.json()).data;
    identity(crypto.randomUUID());
    expect((await (await templatesGET(new Request("http://localhost/api/v1/ai/templates"))).json()).data).toEqual([]);
    expect((await templatesPOST(post("/api/v1/ai/templates", { id: template.id, expectedVersion: 1, name: "修改", instructions: "偷改" }))).status).toBe(409);
    expect((await templatesDELETE(post("/api/v1/ai/templates", { id: template.id, expectedVersion: 1 }, "delete", "DELETE"))).status).toBe(409);
  });
  it("tests only the saved account configuration and masks upstream errors", async () => {
    expect((await testPOST(post("/api/v1/settings/ai/test", {}))).status).toBe(200);
    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ user: "Reply with OK only.", maxTokens: 4096 }));
    expect((await testPOST(post("/api/v1/settings/ai/test", { apiKey: "injected", accountId: "other" }))).status).toBe(400);
    mocks.generate.mockRejectedValueOnce(new Error("Agent transport private-secret /private/path"));
    const failure = await testPOST(post("/api/v1/settings/ai/test", {}));
    expect(failure.status).toBe(502);
    const text = await failure.text(); expect(text).not.toContain("private-secret"); expect(text).not.toContain("/private/path");
  });
  it("bounds bodies and locally extracts uploaded text without calling a model", async () => {
    const oversize = await testPOST(post("/api/v1/settings/ai/test", { value: "x".repeat(2000) }));
    expect(oversize.status).toBe(413);
    expect((await runsPOST(post("/api/v1/ai/runs", { ...payload, context: "x".repeat(310000) }))).status).toBe(413);
    const form = new FormData(); form.append("file", new File(["原文 <script>sample</script>"], "会议.txt", { type: "text/plain" }));
    const response = await extractPOST(new Request("http://localhost/api/v1/ai/extract", { method: "POST", headers: { origin: "http://localhost" }, body: form }));
    expect((await response.json()).data).toEqual({ name: "会议.txt", text: "原文 <script>sample</script>", truncated: false });
    expect(mocks.generate).not.toHaveBeenCalled();
    const invalid = new FormData(); invalid.append("file", new File(["bad"], "script.exe", { type: "application/octet-stream" }));
    expect((await extractPOST(new Request("http://localhost/api/v1/ai/extract", { method: "POST", headers: { origin: "http://localhost" }, body: invalid }))).status).toBe(400);
  });
});
