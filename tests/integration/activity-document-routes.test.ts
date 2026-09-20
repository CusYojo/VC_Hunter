import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, initializeDatabase } from "@/db/client";
import { WorkspaceActivityRepository } from "@/repositories/workspace-activity";
import type { DatabaseSync } from "node:sqlite";
import JSZip from "jszip";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), repository: vi.fn() }));
vi.mock("@/security/workspace-session", () => ({ resolveWorkspaceIdentity: mocks.identity }));
vi.mock("@/workbench/activity-http", () => ({ activityRepository: mocks.repository }));
vi.mock("@/workbench/team", async () => {
  const { identityScope } = await import("@/security/identity-scope");
  return { getCurrentUser: () => ({ id: identityScope.getStore()?.user.id }) };
});
import { POST } from "@/app/api/v1/activity/[id]/documents/route";
import { GET } from "@/app/api/v1/activity/[id]/documents/[documentId]/route";

let database: DatabaseSync;
let repository: WorkspaceActivityRepository;
let activityId: string;
function identity(id: string, role = "investment_manager") { mocks.identity.mockResolvedValue({ user: { id }, accountId: crypto.randomUUID(), tenantId: "org", roles: [role] }); }
function request(name = "审批.txt", type = "text/plain", body = "内部资料", version = "1", key = "upload") {
  const form = new FormData();
  form.set("file", new File([body], name, { type }));
  form.set("expectedVersion", version);
  return new Request(`http://localhost/api/v1/activity/${activityId}/documents`, { method: "POST", headers: { origin: "http://localhost", "idempotency-key": key }, body: form });
}
function read(documentId: string, download = false) {
  return GET(new Request(`http://localhost/api/v1/activity/${activityId}/documents/${documentId}${download ? "?download=1" : ""}`), { params: Promise.resolve({ id: activityId, documentId }) });
}
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BETTER_AUTH_URL", "http://localhost");
  database = createDatabase(":memory:"); initializeDatabase(database);
  repository = new WorkspaceActivityRepository(database, ["alice", "bob", "eve"]);
  mocks.repository.mockReturnValue(repository); identity("alice");
  activityId = repository.create({ kind: "approval", title: "审批", participantIds: ["bob"], dueAt: "2026-09-05T02:00:00.000Z" }, "alice", "create").id;
});
afterEach(() => { database.close(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("approval document API", () => {
  it("uploads an empty-MIME Markdown file and previews text for the reviewer", async () => {
    const response = await POST(request("材料.md", "", "# 保密资料"), { params: Promise.resolve({ id: activityId }) });
    expect(response.status).toBe(201);
    const { data } = await response.json();
    expect(data.version).toBe(2);
    identity("bob", "compliance_reviewer");
    const preview = await read(data.documents[0].id);
    expect(await preview.json()).toMatchObject({ data: { text: "# 保密资料" } });
    expect(preview.headers.get("cache-control")).toContain("no-store");
    const download = await read(data.documents[0].id, true);
    expect(download.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(await download.text()).toBe("# 保密资料");
  });
  it("previews PDF inline with restrictive headers and downloads original bytes", async () => {
    const response = await POST(request("材料.pdf", "application/pdf", "%PDF-test"), { params: Promise.resolve({ id: activityId }) });
    const { data } = await response.json();
    const preview = await read(data.documents[0].id);
    expect(preview.headers.get("content-type")).toBe("application/pdf");
    expect(preview.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(preview.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await preview.text()).toBe("%PDF-test");
  });
  it("requires authentication and author permissions for upload and isolates document reads", async () => {
    const uploaded = repository.uploadDocument(activityId, { expectedVersion: 1, name: "a.txt", mimeType: "text/plain", bytes: Buffer.from("secret") }, "alice", "one");
    const documentId = uploaded.documents![0].id;
    mocks.identity.mockResolvedValue(null);
    expect((await read(documentId)).status).toBe(401);
    expect((await POST(request(), { params: Promise.resolve({ id: activityId }) })).status).toBe(401);
    identity("eve");
    expect((await read(documentId)).status).toBe(404);
    expect((await POST(request(), { params: Promise.resolve({ id: activityId }) })).status).toBe(403);
    identity("bob", "viewer");
    expect((await POST(request(), { params: Promise.resolve({ id: activityId }) })).status).toBe(403);
  });
  it("maps invalid uploads and conflicts without leaking internal failures", async () => {
    const context = { params: Promise.resolve({ id: activityId }) };
    expect((await POST(request("a.exe"), context)).status).toBe(400);
    expect((await POST(request("a.txt", "text/plain", "a", "0"), context)).status).toBe(400);
    expect((await POST(request("a.txt", "text/plain", "a", "1", ""), context)).status).toBe(400);
    expect((await POST(request(), context)).status).toBe(201);
    expect((await POST(request("a.txt", "text/plain", "a", "1", "next"), context)).status).toBe(409);
    vi.spyOn(repository, "readDocument").mockImplementation(() => { throw new Error("SQL secret /private/path"); });
    const response = await read("bad");
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("private/path");
  });
  it("rejects malformed and oversize uploads and allows original download when DOCX preview fails", async () => {
    const context = { params: Promise.resolve({ id: activityId }) };
    const malformed = new Request(`http://localhost/api/v1/activity/${activityId}/documents`, { method: "POST", headers: { origin: "http://localhost", "idempotency-key": "bad" }, body: "bad" });
    expect((await POST(malformed, context)).status).toBe(400);
    expect((await POST(request("large.txt", "text/plain", "x".repeat(20 * 1024 * 1024 + 1)), context)).status).toBe(413);
    const response = await POST(request("bad.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "PKinvalid"), context);
    const { data } = await response.json();
    const preview = await read(data.documents[0].id);
    expect(preview.status).toBe(422);
    expect((await preview.json()).error.code).toBe("PREVIEW_UNAVAILABLE");
    const download = await read(data.documents[0].id, true);
    expect(await download.text()).toBe("PKinvalid");
  });
  it("returns 422 for a DOCX compression bomb while retaining the original download", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", "<w:t>" + "x".repeat(8 * 1024 * 1024) + "</w:t>");
    const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const saved = repository.uploadDocument(activityId, { name: "bomb.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes, expectedVersion: 1 }, "alice", "bomb");
    const id = saved.documents![0].id;
    const preview = await read(id);
    expect(preview.status).toBe(422);
    expect((await preview.json()).error.code).toBe("PREVIEW_UNAVAILABLE");
    expect(Buffer.from(await (await read(id, true)).arrayBuffer())).toEqual(bytes);
  });
});
