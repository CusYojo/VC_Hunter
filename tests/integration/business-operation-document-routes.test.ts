import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import { businessOperationDocumentsMigration } from "@/workbench/business-operation-documents-migration";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), database: vi.fn() }));
vi.mock("@/security/workspace-session", () => ({ resolveWorkspaceIdentity: mocks.identity }));
vi.mock("@/db/app", () => ({ getAppDatabase: mocks.database }));
import { POST } from "@/app/api/v1/operations/[kind]/route";
import { PATCH } from "@/app/api/v1/operations/[kind]/[id]/route";
import { GET as documentGET } from "@/app/api/v1/operations/[kind]/[id]/documents/[documentId]/route";
let db: DatabaseSync;
const value = { name: "费用附件测试", status: "recorded", data: { amountCny: 10, occurredOn: "2026-09-04" } };
const context = { params: Promise.resolve({ kind: "expense" }) };
function identity(role = "investment_manager", tenantId = "org-a") { mocks.identity.mockResolvedValue({ user: { id: "u1", name: "用户" }, accountId: crypto.randomUUID(), tenantId, roles: [role] }); }
function request(body: unknown, files: File[], method = "POST", suffix = "", key = crypto.randomUUID()) {
  const form = new FormData(); form.set("payload", JSON.stringify(body)); files.forEach(file => form.append("files", file));
  return new Request(`http://localhost/api/v1/operations/expense${suffix}`, { method, headers: { origin: "http://localhost", "idempotency-key": key }, body: form });
}
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BETTER_AUTH_URL", "http://localhost");
  db = createDatabase(":memory:"); initializeDatabase(db); seedDemoData(db);
  if (!db.prepare("SELECT name FROM sqlite_master WHERE name='business_operation_documents'").get()) db.exec(businessOperationDocumentsMigration.upSql);
  mocks.database.mockReturnValue(db); identity();
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("business record multipart API", () => {
  it("creates then appends files through multipart while preserving previous attachments", async () => {
    const response = await POST(request(value, [new File(["费用正文"], "费用.txt", { type: "text/plain" })]), context);
    expect(response.status).toBe(201);
    const record = (await response.json()).data;
    expect(record.documents).toEqual([expect.objectContaining({ originalName: "费用.txt", source: "upload" })]);
    const patchContext = { params: Promise.resolve({ kind: "expense", id: record.id }) };
    const changed = await PATCH(request({ version: 1, name: "补充费用附件" }, [new File(["补充"], "补充.txt", { type: "text/plain" })], "PATCH", `/${record.id}`, "append"), patchContext);
    expect(changed.status).toBe(200);
    expect((await changed.json()).data.documents).toHaveLength(2);
  });
  it("rejects invalid files and disallows viewer mutation before persisting records", async () => {
    const invalid = await POST(request(value, [new File(["bad"], "bad.exe", { type: "application/octet-stream" })]), context);
    expect(invalid.status).toBe(400); expect((await invalid.json()).error.message).toContain("仅支持");
    identity("viewer"); expect((await POST(request(value, [new File(["doc"], "safe.txt", { type: "text/plain" })]), context)).status).toBe(403);
    expect(db.prepare("SELECT count(*) n FROM business_operation_records").get()?.n).toBe(0);
  });
  it("previews and downloads originals with record and tenant authorization", async () => {
    const response = await POST(request(value, [new File(["附件 <script>原文</script>"], "原文.txt", { type: "text/plain" }), new File(["%PDF-invalid but downloadable"], "扫描.pdf", { type: "application/pdf" })]), context);
    const record = (await response.json()).data;
    const [text, pdf] = record.documents;
    const read = (documentId: string, suffix = "") => documentGET(new Request(`http://localhost/api/v1/operations/expense/${record.id}/documents/${documentId}${suffix}`), { params: Promise.resolve({ kind: "expense", id: record.id, documentId }) });
    const preview = await read(text.id); expect(preview.status).toBe(200); expect((await preview.json()).data.text).toContain("<script>");
    const download = await read(text.id, "?download=1"); expect(download.status).toBe(200); expect(download.headers.get("content-disposition")).toContain("attachment"); expect(download.headers.get("cache-control")).toContain("no-store"); expect(await download.text()).toContain("附件");
    const original = await read(pdf.id); expect(original.status).toBe(200); expect(original.headers.get("content-type")).toBe("application/pdf"); expect(await original.text()).toBe("%PDF-invalid but downloadable");
    identity("viewer"); expect((await read(text.id)).status).toBe(200);
    identity("investment_manager", "org-b"); expect((await read(text.id)).status).toBe(404);
    mocks.identity.mockResolvedValue(null); expect((await read(text.id)).status).toBe(401);
  });
  it("rejects multipart metadata injection and more than ten files", async () => {
    const form = new FormData(); form.set("payload", JSON.stringify(value)); form.set("tenantId", "other");
    const invalid = await POST(new Request("http://localhost/api/v1/operations/expense", { method: "POST", headers: { origin: "http://localhost", "idempotency-key": "invalid" }, body: form }), context);
    expect(invalid.status).toBe(400);
    const files = Array.from({ length: 11 }, () => new File(["text"], "test.txt", { type: "text/plain" }));
    expect((await POST(request(value, files), context)).status).toBe(400);
    expect(db.prepare("SELECT count(*) n FROM business_operation_records").get()?.n).toBe(0);
  });
});
