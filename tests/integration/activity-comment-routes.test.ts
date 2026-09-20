import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import { WorkspaceActivityRepository } from "@/repositories/workspace-activity";
import { activityCommentsMigration } from "@/workbench/activity-comments-migration";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), database: vi.fn() }));
vi.mock("@/security/workspace-session", () => ({ resolveWorkspaceIdentity: mocks.identity }));
vi.mock("@/db/app", () => ({ getAppDatabase: mocks.database }));
vi.mock("@/workbench/team", async () => { const { identityScope } = await import("@/security/identity-scope"); return { getCurrentUser: () => ({ id: identityScope.getStore()?.user.id }), loadTeamMembers: () => ["alice", "bob", "eve"].map(id => ({ id })) }; });
import { GET, POST } from "@/app/api/v1/activity/[id]/comments/route";
import { GET as document } from "@/app/api/v1/activity/[id]/comments/[commentId]/documents/[documentId]/route";
let db: DatabaseSync; let activityId: string;
function identity(id: string) { mocks.identity.mockResolvedValue({ user: { id }, accountId: crypto.randomUUID(), tenantId: "org", roles: ["investment_manager"] }); }
const context = () => ({ params: Promise.resolve({ id: activityId }) });
function request(body: unknown, key = crypto.randomUUID(), files?: File[]) { const form = new FormData(); form.set("payload", JSON.stringify(body)); files?.forEach(file => form.append("files", file)); return new Request(`http://localhost/api/v1/activity/${activityId}/comments`, { method: "POST", headers: { origin: "http://localhost", "idempotency-key": key, ...(!files ? { "content-type": "application/json" } : {}) }, body: files ? form : JSON.stringify(body) }); }
beforeEach(() => { vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BETTER_AUTH_URL", "http://localhost"); db = createDatabase(":memory:"); initializeDatabase(db); seedDemoData(db); if (!db.prepare("SELECT name FROM sqlite_master WHERE name='activity_comments'").get()) db.exec(activityCommentsMigration.upSql); mocks.database.mockReturnValue(db); identity("alice"); activityId = new WorkspaceActivityRepository(db, ["alice", "bob", "eve"]).create({ kind: "approval", title: "批注审批", participantIds: ["bob"], dueAt: "2026-10-01T10:00:00.000Z" }, "alice", "activity").id; });
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
it("serves authenticated replies, text previews and original downloads only to the author and recipients", async () => {
  const first = await POST(request({ body: "发起人意见" }), context()); expect(first.status).toBe(201); const comment = (await first.json()).data;
  identity("bob"); const saved = await POST(request({ parentId: comment.id }, undefined, [new File(["接收人补充原件"], "批复附件.txt", { type: "text/plain" })]), context()); expect(saved.status).toBe(201); const reply = (await saved.json()).data;
  identity("alice"); const params = { params: Promise.resolve({ id: activityId, commentId: reply.id, documentId: reply.documents[0].id }) };
  const url = `http://localhost/api/v1/activity/${activityId}/comments/${reply.id}/documents/${reply.documents[0].id}`;
  const preview = await document(new Request(url), params); expect(preview.status).toBe(200); expect((await preview.json()).data.text).toBe("接收人补充原件");
  const bytes = await document(new Request(url + "?download=1"), params); expect(bytes.status).toBe(200); expect(await bytes.text()).toBe("接收人补充原件"); expect(bytes.headers.get("cache-control")).toContain("private"); expect(bytes.headers.get("content-disposition")).toContain("attachment");
  const listing = await GET(new Request(`http://localhost/api/v1/activity/${activityId}/comments`), context()); expect((await listing.json()).data.items).toHaveLength(2);
  identity("eve"); expect((await GET(new Request(`http://localhost/api/v1/activity/${activityId}/comments`), context())).status).toBe(404); expect((await POST(request({ body: "越权" }), context())).status).toBe(404); expect((await document(new Request(url), params)).status).toBe(404);
  mocks.identity.mockResolvedValue(null); expect((await POST(request({ body: "匿名" }), context())).status).toBe(401);
});
it("rejects forged input, invalid cursors, blank comments, unsafe files and replay conflicts without partial writes", async () => {
  expect((await POST(request({ body: "正文", authorId: "bob" }), context())).status).toBe(400);
  expect((await POST(request({}), context())).status).toBe(400);
  expect((await POST(request({ body: "正文" }, ""), context())).status).toBe(400);
  expect((await POST(request({ body: "正文" }, undefined, [new File(["bad"], "bad.exe")]), context())).status).toBe(400);
  expect((await GET(new Request(`http://localhost/api/v1/activity/${activityId}/comments?after=-1`), context())).status).toBe(400);
  expect((await GET(new Request(`http://localhost/api/v1/activity/${activityId}/comments?actorId=bob`), context())).status).toBe(400);
  const one = await POST(request({ body: "一条" }, "same"), context()); expect(one.status).toBe(201);
  const two = await POST(request({ body: "一条" }, "same"), context()); expect((await two.json()).data.id).toBe((await one.json()).data.id);
  expect((await POST(request({ body: "二条" }, "same"), context())).status).toBe(409);
  expect(db.prepare("SELECT count(*) n FROM activity_comments").get()?.n).toBe(1);
});
it("does not expose storage exceptions or accept oversized/invalid multipart payloads", async () => {
  const badForm = new FormData(); badForm.set("payload", "{");
  const multipart = new Request(`http://localhost/api/v1/activity/${activityId}/comments`, { method: "POST", headers: { origin: "http://localhost", "idempotency-key": "invalid" }, body: badForm });
  expect((await POST(multipart, context())).status).toBe(400);
  expect((await POST(request({ body: "x".repeat(70000) }), context())).status).toBe(413);
  db.exec("CREATE TRIGGER fail_comment BEFORE INSERT ON activity_comments BEGIN SELECT RAISE(ABORT,'private-sensitive-storage-path'); END");
  const response = await POST(request({ body: "触发故障" }), context()); expect(response.status).toBe(500); expect(await response.text()).not.toContain("private-sensitive");
});
it("serves PDF inline safely and permits downloading an original even if preview parsing fails", async () => {
  const pdf = await POST(request({}, undefined, [new File(["%PDF-1.4\n%%EOF"], "审批原件's.pdf", { type: "application/pdf" })]), context());
  expect(pdf.status).toBe(201); const saved = (await pdf.json()).data;
  const params = { params: Promise.resolve({ id: activityId, commentId: saved.id, documentId: saved.documents[0].id }) };
  const url = `http://localhost/api/v1/activity/${activityId}/comments/${saved.id}/documents/${saved.documents[0].id}`;
  const inline = await document(new Request(url), params); expect(inline.status).toBe(200); expect(inline.headers.get("content-type")).toBe("application/pdf"); expect(inline.headers.get("content-disposition")).toContain("inline"); expect(inline.headers.get("content-disposition")).toContain("%27");
  const word = await POST(request({}, undefined, [new File([new Uint8Array([80,75,3,4,0,0,0,0])], "破损.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })]), context());
  expect(word.status).toBe(201); const broken = (await word.json()).data;
  const wordParams = { params: Promise.resolve({ id: activityId, commentId: broken.id, documentId: broken.documents[0].id }) };
  expect((await document(new Request(url), wordParams)).status).toBe(422);
  expect((await document(new Request(url + "?download=1"), wordParams)).status).toBe(200);
});
it("rejects malformed multipart members, too many files and a reply parent belonging to another activity", async () => {
  const url = `http://localhost/api/v1/activity/${activityId}/comments`;
  for (const mode of ["extra", "string", "duplicate"]) {
    const form = new FormData(); form.set("payload", "{}");
    if (mode === "extra") form.set("actorId", "forged");
    if (mode === "string") form.set("files", "not-a-file");
    if (mode === "duplicate") form.append("payload", "{}");
    expect((await POST(new Request(url, { method: "POST", headers: { origin: "http://localhost", "idempotency-key": crypto.randomUUID() }, body: form }), context())).status).toBe(400);
  }
  expect((await POST(request({}, undefined, Array.from({ length: 11 }, () => new File(["x"], "x.txt", { type: "text/plain" }))), context())).status).toBe(400);
  expect((await POST(request({ body: "回复", parentId: crypto.randomUUID() }), context())).status).toBe(400);
  expect((await POST(request({ projectDocumentIds: ["missing"] }), context())).status).toBe(400);
});
