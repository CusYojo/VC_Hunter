import { afterEach, beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { WorkspaceActivityRepository } from "@/repositories/workspace-activity";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), database: vi.fn() }));
vi.mock("@/security/workspace-session", () => ({ resolveWorkspaceIdentity: mocks.identity }));
vi.mock("@/db/app", () => ({ getAppDatabase: mocks.database }));
vi.mock("@/workbench/team", async () => { const { identityScope } = await import("@/security/identity-scope"); return { getCurrentUser: () => ({ id: identityScope.getStore()?.user.id }), loadTeamMembers: () => ["alice", "bob", "eve"].map(id => ({ id })) }; });
import { POST } from "@/app/api/v1/activity/[id]/comments/route";
import { DELETE } from "@/app/api/v1/activity/[id]/comments/[commentId]/route";
import { GET } from "@/app/api/v1/activity/[id]/comments/[commentId]/documents/[documentId]/route";
let db: DatabaseSync, activityId: string;
const identity = (id: string) => mocks.identity.mockResolvedValue({ user: { id }, accountId: crypto.randomUUID(), tenantId: "org", roles: ["investment_manager"] });
function request(name: string, mime: string, bytes: Uint8Array) {
  const form = new FormData(); form.set("payload", JSON.stringify({ body: "现场照片" })); form.append("files", new File([new Uint8Array(bytes)], name, { type: mime }));
  return new Request(`http://localhost/api/v1/activity/${activityId}/comments`, { method: "POST", headers: { origin: "http://localhost", "idempotency-key": crypto.randomUUID() }, body: form });
}
beforeEach(() => { vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BETTER_AUTH_URL", "http://localhost"); db = createDatabase(":memory:"); initializeDatabase(db); mocks.database.mockReturnValue(db); identity("alice"); activityId = new WorkspaceActivityRepository(db, ["alice", "bob", "eve"]).create({ kind: "task", title: "项目现场核验", participantIds: ["bob"] }, "alice", "activity").id; });
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
it.each(["png", "jpeg", "webp"] as const)("uploads and previews real %s photos only for authorized participants, then revokes deleted attachments", async (format) => {
  const original = await sharp({ create: { width: 20, height: 10, channels: 3, background: "#be785c" } }).toFormat(format).withMetadata({ exif: { IFD0: { Artist: "private gps owner" } } }).toBuffer();
  const uploaded = await POST(request(`现场.${format}`, `image/${format}`, original), { params: Promise.resolve({ id: activityId }) });
  expect(uploaded.status).toBe(201); const comment = (await uploaded.json()).data;
  expect(comment.documents[0]).toMatchObject({ kind: "image", originalName: `现场.${format}` });
  const ids = { id: activityId, commentId: comment.id, documentId: comment.documents[0].id };
  const params = { params: Promise.resolve(ids) }, url = `http://localhost/api/v1/activity/${activityId}/comments/${comment.id}/documents/${ids.documentId}`;
  identity("bob"); const preview = await GET(new Request(url), params);
  expect(preview.status).toBe(200); expect(preview.headers.get("content-type")).toBe(`image/${format}`);
  expect(preview.headers.get("x-content-type-options")).toBe("nosniff"); expect(preview.headers.get("content-security-policy")).toContain("sandbox");
  expect(preview.headers.get("cache-control")).toContain("private"); expect(preview.headers.get("content-disposition")).toContain("inline");
  const metadata = await sharp(Buffer.from(await preview.arrayBuffer())).metadata(); expect(metadata.exif).toBeUndefined(); expect(metadata.format).toBe(format);
  expect((await GET(new Request(`${url}?download=1`), params)).headers.get("content-disposition")).toContain("attachment");
  identity("eve"); expect((await GET(new Request(url), params)).status).toBe(404);
  mocks.identity.mockResolvedValue(null); expect((await GET(new Request(url), params)).status).toBe(401);
  identity("alice"); const deleted = await DELETE(new Request(`http://localhost/api/v1/activity/${activityId}/comments/${comment.id}`, { method: "DELETE", headers: { origin: "http://localhost" } }), { params: Promise.resolve({ id: activityId, commentId: comment.id }) });
  expect(deleted.status).toBe(200); expect((await GET(new Request(url), params)).status).toBe(404);
});
it("rejects forged photo uploads with a safe client error and no partial comment", async () => {
  for (const [name, mime, bytes] of [["fake.png", "image/png", "<svg>bad</svg>"], ["fake.svg", "image/svg+xml", "<svg/>"], ["fake.jpg", "image/jpeg", "not-a-photo"]]) {
    const result = await POST(request(name, mime, Buffer.from(bytes)), { params: Promise.resolve({ id: activityId }) });
    expect(result.status).toBe(400); expect((await result.json()).error.code).toBe("IMAGE_INVALID");
  }
  expect(db.prepare("SELECT count(*) AS count FROM activity_comments").get()?.count).toBe(0);
});
