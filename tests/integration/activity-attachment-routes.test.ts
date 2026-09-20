import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { uploadProjectDocument } from "@/workbench/documents";
import { activityProjectDocumentsMigration } from "@/workbench/activity-project-documents-migration";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), database: vi.fn() }));
vi.mock("@/security/workspace-session", () => ({ resolveWorkspaceIdentity: mocks.identity }));
vi.mock("@/db/app", () => ({ getAppDatabase: mocks.database }));
vi.mock("@/workbench/team", async () => {
  const { identityScope } = await import("@/security/identity-scope");
  return { getCurrentUser: () => ({ id: identityScope.getStore()?.user.id }), loadTeamMembers: () => ["alice", "bob", "eve"].map(id => ({ id })) };
});
import { POST as create } from "@/app/api/v1/activity/route";
import { POST as attach } from "@/app/api/v1/activity/[id]/documents/route";
import { GET as read } from "@/app/api/v1/activity/[id]/documents/[documentId]/route";
import { GET as files } from "@/app/api/v1/project-files/route";
let db: DatabaseSync; let root: string;
const body = { kind: "meeting", title: "有资料的会议", participantIds: ["bob"], dueAt: "2026-10-01T10:00:00.000Z" };
function identity(user: string) { mocks.identity.mockResolvedValue({ user: { id: user }, accountId: crypto.randomUUID(), tenantId: "org", roles: ["investment_manager"] }); }
function request(payload: unknown, fileNames: string[] = ["会议资料.txt"], key = "create") {
  const form = new FormData(); form.set("payload", JSON.stringify(payload));
  fileNames.forEach(name => form.append("files", new File(["会议内部材料"], name, { type: "text/plain" })));
  return new Request("http://localhost/api/v1/activity", { method: "POST", headers: { origin: "http://localhost", "idempotency-key": key }, body: form });
}
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BETTER_AUTH_URL", "http://localhost");
  db = createDatabase(":memory:"); initializeDatabase(db); seedDemoData(db);
  if (!db.prepare("SELECT name FROM sqlite_master WHERE name='activity_project_documents'").get()) db.exec(activityProjectDocumentsMigration.upSql);
  root = mkdtempSync(join(tmpdir(), "activity-api-")); vi.stubEnv("VC_HUNTER_DOCUMENT_ROOT", root);
  mocks.database.mockReturnValue(db); identity("alice");
});
afterEach(() => { db.close(); rmSync(root, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.clearAllMocks(); });
async function original() {
  const expectedVersion = Number(db.prepare("SELECT version FROM projects WHERE id='project-qiongxin'").get()?.version);
  return uploadProjectDocument(db, { projectId: "project-qiongxin", expectedVersion, name: "@原项目资料.txt", mimeType: "text/plain", bytes: Buffer.from("无需解析即可下载的原始项目材料"), externalPolicy: "local_only", actorId: "alice", idempotencyKey: crypto.randomUUID(), storageRoot: root });
}
it("creates uploaded and referenced attachments together and privately serves the original to a participant", async () => {
  const source = await original();
  const response = await create(request({ ...body, projectDocumentIds: [source.id] }));
  expect(response.status).toBe(201); const activity = (await response.json()).data;
  expect(activity.documents).toHaveLength(2); expect(activity.documents.map((d: {source: string}) => d.source).sort()).toEqual(["project", "upload"]);
  const documentId = activity.documents.find((d: {source: string}) => d.source === "project").id;
  const url = `http://localhost/api/v1/activity/${activity.id}/documents/${documentId}?download=1`;
  identity("bob"); const params = { params: Promise.resolve({ id: activity.id, documentId }) };
  const downloaded = await read(new Request(url), params);
  expect(downloaded.status).toBe(200); expect(downloaded.headers.get("content-disposition")).toContain("attachment");
  expect(downloaded.headers.get("cache-control")).toContain("private"); expect(await downloaded.text()).toBe("无需解析即可下载的原始项目材料");
  identity("eve"); expect((await read(new Request(url), params)).status).toBe(404);
  mocks.identity.mockResolvedValue(null); expect((await files(new Request("http://localhost/api/v1/project-files"))).status).toBe(401);
});
it("exposes metadata search without paths or bytes and rejects forged query fields", async () => {
  await original();
  const response = await files(new Request("http://localhost/api/v1/project-files?q=" + encodeURIComponent("@原") + "&projectId=project-qiongxin"));
  expect(response.status).toBe(200); const payload = (await response.json()).data;
  expect(payload.total).toBe(1); expect(payload.hasMore).toBe(false); expect(payload.items[0]).toMatchObject({ originalName: "@原项目资料.txt", kind: "text", projectId: "project-qiongxin" });
  expect(JSON.stringify(payload)).not.toContain(root); expect(JSON.stringify(payload)).not.toContain("storage_key"); expect(JSON.stringify(payload)).not.toContain("无需解析");
  expect((await files(new Request("http://localhost/api/v1/project-files?tenantId=other"))).status).toBe(400);
});
it("rejects invalid multipart data atomically and lets authors supplement project references with version checks", async () => {
  expect((await create(request(body, ["valid.txt", "bad.exe"]))).status).toBe(400);
  expect(db.prepare("SELECT count(*) n FROM workspace_activity").get()?.n).toBe(0);
  expect((await create(request({ ...body, accountId: "forged" }))).status).toBe(400);
  const response = await create(request(body)); const activity = (await response.json()).data;
  const source = await original();
  const refRequest = (expectedVersion: number, key = "refs") => new Request(`http://localhost/api/v1/activity/${activity.id}/documents`, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify({ projectDocumentIds: [source.id], expectedVersion }) });
  const params = { params: Promise.resolve({ id: activity.id }) };
  identity("bob"); expect((await attach(refRequest(1), params)).status).toBe(403);
  identity("alice"); const attached = await attach(refRequest(1), params);
  expect(attached.status).toBe(201); expect((await attached.json()).data.documents).toHaveLength(2);
  expect((await attach(refRequest(1, "stale"), params)).status).toBe(409);
});
