import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import { uploadProjectDocument } from "@/workbench/documents";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), database: vi.fn(), directory: vi.fn() }));
vi.mock("@/auth/server", () => ({ getAuthService: () => ({ organization: { directory: mocks.directory } }) }));
vi.mock("@/security/workspace-session", () => ({ resolveWorkspaceIdentity: mocks.identity }));
vi.mock("@/db/app", () => ({ getAppDatabase: mocks.database }));
import { GET as contentGET } from "@/app/api/v1/projects/[id]/documents/[documentId]/content/route";
import { GET, POST } from "@/app/api/v1/projects/[id]/documents/[documentId]/annotations/route";
let database: DatabaseSync;
let storageRoot: string;
let documentId: string;
const projectId = "project-qiongxin";
function identity(role = "investment_manager", id = "alice") { mocks.identity.mockResolvedValue({ user: { id, name: id === "alice" ? "王经理" : "研究员" }, accountId: crypto.randomUUID(), tenantId: "org", roles: [role] }); }
function context(id = projectId, docId = documentId) { return { params: Promise.resolve({ id, documentId: docId }) }; }
function url(kind = "annotations") { return `http://localhost/api/v1/projects/${projectId}/documents/${documentId}/${kind}`; }
function post(body: unknown, key = crypto.randomUUID()) { return POST(new Request(url(), { method: "POST", headers: { origin: "http://localhost", "idempotency-key": key }, body: JSON.stringify(body) }), context()); }
beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BETTER_AUTH_URL", "http://localhost");
  database = createDatabase(":memory:"); initializeDatabase(database); seedDemoData(database);
  storageRoot = mkdtempSync(join(tmpdir(), "vc-document-api-")); vi.stubEnv("VC_HUNTER_DOCUMENT_ROOT", storageRoot);
  mocks.database.mockReturnValue(database);
  mocks.directory.mockReturnValue({ members: [
    { id: "alice", name: "王经理", active: true, accountId: "alice-account", isPlaceholder: false },
    { id: "bob", name: "研究员", active: true, accountId: "bob-account", isPlaceholder: false },
  ], departments: [] }); identity();
  const uploaded = await uploadProjectDocument(database, { projectId, expectedVersion: 1, name: "材料.txt", mimeType: "text/plain", bytes: Buffer.from("内部资料"), externalPolicy: "local_only", actorId: "alice", idempotencyKey: "upload", storageRoot });
  documentId = uploaded.id;
});
afterEach(() => { database.close(); rmSync(storageRoot, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("project document API", () => {
  it("previews text and downloads original with safe headers", async () => {
    const preview = await contentGET(new Request(url("content")), context());
    expect(await preview.json()).toMatchObject({ data: { text: "内部资料", truncated: false } });
    expect(preview.headers.get("cache-control")).toContain("no-store");
    const download = await contentGET(new Request(url("content") + "?download=1"), context());
    expect(download.headers.get("content-disposition")).toContain("attachment;");
    expect(download.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await download.text()).toBe("内部资料");
  });
  it("stores server-authenticated author, replies and review actions", async () => {
    expect((await post({ content: "财务核实" }, "first")).status).toBe(201);
    const first = await (await GET(new Request(url()), context())).json();
    expect(first.data.items[0]).toMatchObject({ authorId: "alice", authorName: "王经理" });
    identity("researcher", "bob");
    const reply = await post({ content: "已完成", parentId: first.data.items[0].id });
    expect((await reply.json()).data.items[1]).toMatchObject({ authorId: "bob", parentId: first.data.items[0].id });
    expect(mocks.directory).toHaveBeenCalledWith("org");
    expect(database.prepare("SELECT recipient_id,actor_id,kind FROM member_notifications").all()).toEqual([
      { recipient_id: "alice", actor_id: "bob", kind: "document_comment" },
    ]);
    expect((await post({ action: "approve", content: "" })).status).toBe(403);
    identity("compliance_reviewer");
    const review = await post({ action: "approve", content: "" });
    expect((await review.json()).data.reviewStatus).toBe("approved");
    expect((await post({ content: "spoof", authorId: "admin" })).status).toBe(400);
    expect((await post({ content: "财务核实" }, "first")).status).toBe(201);
    expect((await post({ content: "不同" }, "first")).status).toBe(409);
  });
  it("requires login, limits viewers to read and enforces document binding", async () => {
    mocks.identity.mockResolvedValue(null);
    expect((await GET(new Request(url()), context())).status).toBe(401);
    expect((await contentGET(new Request(url("content")), context())).status).toBe(401);
    identity("viewer");
    const response = await GET(new Request(url()), context());
    expect((await response.json()).data.permissions).toEqual({ canComment: false, canReview: false });
    expect((await post({ content: "denied" })).status).toBe(403);
    expect((await GET(new Request(url()), context("project-yaoshi"))).status).toBe(404);
    expect((await contentGET(new Request(url("content")), context("project-yaoshi"))).status).toBe(404);
  });
  it("returns schema errors and masks unexpected database errors", async () => {
    expect((await post({ content: "" })).status).toBe(400);
    expect((await post({ content: "x" }, "")).status).toBe(400);
    expect((await post({ content: "x", parentId: "missing" })).status).toBe(400);
    const malformed = await POST(new Request(url(), { method: "POST", headers: { origin: "http://localhost", "idempotency-key": "bad" }, body: "bad" }), context());
    expect(malformed.status).toBe(400);
    mocks.database.mockImplementationOnce(() => { throw new Error("secret /private/path"); });
    const error = await GET(new Request(url()), context());
    expect(error.status).toBe(500);
    expect(JSON.stringify(await error.json())).not.toContain("/private/path");
  });
  it("previews PDF inline and retains DOCX download when preview is unavailable", async () => {
    const pdf = await uploadProjectDocument(database, { projectId, expectedVersion: 2, name: "资料.pdf", mimeType: "application/pdf", bytes: Buffer.from("%PDF-test"), externalPolicy: "local_only", actorId: "alice", idempotencyKey: "pdf", storageRoot });
    const preview = await contentGET(new Request(url("content")), context(projectId, pdf.id));
    expect(preview.headers.get("content-type")).toBe("application/pdf");
    expect(preview.headers.get("content-disposition")).toContain("inline;");
    expect(await preview.text()).toBe("%PDF-test");
    const docx = await uploadProjectDocument(database, { projectId, expectedVersion: 3, name: "资料.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: Buffer.from("PKinvalid"), externalPolicy: "local_only", actorId: "alice", idempotencyKey: "docx", storageRoot });
    expect((await contentGET(new Request(url("content")), context(projectId, docx.id))).status).toBe(422);
    expect(await (await contentGET(new Request(url("content") + "?download=1"), context(projectId, docx.id))).text()).toBe("PKinvalid");
  });
});
