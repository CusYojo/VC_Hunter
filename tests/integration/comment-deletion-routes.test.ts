import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import { WorkspaceActivityRepository } from "@/repositories/workspace-activity";
import { ActivityCommentsRepository } from "@/repositories/activity-comments";
import { SqliteDealTimelineRepository } from "@/workbench/deal-timeline";
import { addDocumentAnnotation } from "@/workbench/project-document-annotations";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), database: vi.fn(), timeline: vi.fn() }));
vi.mock("@/security/workspace-session", () => ({ resolveWorkspaceIdentity: mocks.identity }));
vi.mock("@/db/app", () => ({ getAppDatabase: mocks.database, getDealTimelineRepository: mocks.timeline }));
vi.mock("@/workbench/team", async () => { const { identityScope } = await import("@/security/identity-scope"); return { getCurrentUser: () => identityScope.getStore()?.user, loadTeamMembers: () => ["alice", "bob", "admin"].map(id => ({ id })) }; });
import { DELETE as deleteActivity } from "@/app/api/v1/activity/[id]/comments/[commentId]/route";
import { DELETE as deleteProject } from "@/app/api/v1/projects/[id]/comments/[commentId]/route";
import { DELETE as deleteAnnotation } from "@/app/api/v1/projects/[id]/documents/[documentId]/annotations/[annotationId]/route";
import { GET as readAttachment } from "@/app/api/v1/activity/[id]/comments/[commentId]/documents/[documentId]/route";
let db: DatabaseSync; let activityId: string; let commentId: string; let projectCommentId: string; let annotationId: string; let attachmentId: string;
const projectId = "project-qiongxin";
const identity = (id: string, roles = ["researcher"]) => mocks.identity.mockResolvedValue({ user: { id, name: id, role: "成员", capabilities: [] }, accountId: crypto.randomUUID(), tenantId: "org", roles });
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BETTER_AUTH_URL", "https://vc.example");
  db = createDatabase(":memory:"); initializeDatabase(db); seedDemoData(db); mocks.database.mockReturnValue(db);
  const timeline = new SqliteDealTimelineRepository(db, ["alice", "bob", "admin"].map(id => ({ id, name: id, role: "成员", tracks: [], subtracks: [], currentLoad: 0 }))); mocks.timeline.mockReturnValue(timeline);
  activityId = new WorkspaceActivityRepository(db, ["alice", "bob"]).create({ kind: "task", title: "Test", participantIds: ["bob"] }, "alice", "activity").id;
  const item = new ActivityCommentsRepository(db, ["alice", "bob"]).create(activityId, { body: "private" }, "alice", "comment", [{ name: "file.txt", mimeType: "text/plain", bytes: Buffer.from("private") }]);
  commentId = item.id; attachmentId = item.documents[0].id;
  projectCommentId = timeline.addComment(projectId, { body: "private" }, "project", "alice").id;
  db.prepare("INSERT INTO project_documents(id,project_id,original_name,storage_key,media_type,document_kind,byte_length,sha256,external_policy,uploaded_by,created_at,updated_at,parse_status,analysis_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run("doc", projectId, "doc.txt", "doc", "text/plain", "text", 1, "hash", "local_only", "alice", "2026-09-04", "2026-09-04", "queued", "queued");
  annotationId = addDocumentAnnotation(db, projectId, "doc", { content: "private" }, { id: "alice", name: "Alice", roles: ["researcher"] }, "annotation").items[0].id;
  identity("alice");
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
function routes() { return [
  () => deleteActivity(new Request(`https://vc.example/api/v1/activity/${activityId}/comments/${commentId}`, { method: "DELETE", headers: { origin: "https://vc.example" } }), { params: Promise.resolve({ id: activityId, commentId }) }),
  () => deleteProject(new Request(`https://vc.example/api/v1/projects/${projectId}/comments/${projectCommentId}`, { method: "DELETE", headers: { origin: "https://vc.example" } }), { params: Promise.resolve({ id: projectId, commentId: projectCommentId }) }),
  () => deleteAnnotation(new Request(`https://vc.example/api/v1/projects/${projectId}/documents/doc/annotations/${annotationId}`, { method: "DELETE", headers: { origin: "https://vc.example" } }), { params: Promise.resolve({ id: projectId, documentId: "doc", annotationId }) }),
]; }
it("rejects anonymous callers and other authors on every resource", async () => {
  mocks.identity.mockResolvedValue(null);
  for (const route of routes()) expect((await route()).status).toBe(401);
  identity("bob");
  for (const route of routes()) expect((await route()).status).toBe(403);
  expect(db.prepare("SELECT body FROM activity_comments WHERE id=?").get(commentId)?.body).toBe("private");
});
it.each(["alice", "admin"])("allows %s, returns tombstones, and forbids attachment reads afterwards", async id => {
  identity(id, id === "admin" ? ["org_admin"] : ["viewer"]);
  for (const route of routes()) {
    const response = await route(); expect(response.status).toBe(200);
    const { data } = await response.json(); expect(data.items?.[0] ?? data).toMatchObject({ deletedAt: expect.any(String), canDelete: false });
    expect(JSON.stringify(data)).not.toContain("private");
    expect((await route()).status).toBe(200);
  }
  const response = await readAttachment(new Request(`https://vc.example/api/v1/activity/${activityId}/comments/${commentId}/documents/${attachmentId}`), { params: Promise.resolve({ id: activityId, commentId, documentId: attachmentId }) });
  expect(response.status).toBe(404);
});
it("returns not found for a mismatched resource and cannot be promoted by body fields", async () => {
  identity("bob");
  const request = new Request(`https://vc.example/api/v1/projects/${projectId}/comments/${projectCommentId}`, { method: "DELETE", headers: { origin: "https://vc.example", "content-type": "application/json" }, body: JSON.stringify({ authorId: "alice", roles: ["org_admin"] }) });
  expect((await deleteProject(request, { params: Promise.resolve({ id: projectId, commentId: projectCommentId }) })).status).toBe(403);
  identity("alice");
  expect((await deleteAnnotation(new Request(`https://vc.example/api/v1/projects/${projectId}/documents/doc/annotations/missing`, { method: "DELETE", headers: { origin: "https://vc.example" } }), { params: Promise.resolve({ id: projectId, documentId: "doc", annotationId: "missing" }) })).status).toBe(404);
});
