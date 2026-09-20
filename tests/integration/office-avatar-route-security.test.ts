import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), submit: vi.fn(), latest: vi.fn(), list: vi.fn(), read: vi.fn(), review: vi.fn() }));
vi.mock("@/security/workspace-session", () => ({ resolveWorkspaceIdentity: mocks.identity }));
vi.mock("@/db/app", () => ({ getAppDatabase: () => ({}) }));
vi.mock("@/auth/server", () => ({ getAuthService: () => ({ organization: {} }) }));
vi.mock("@/organization/office-avatar-service", () => ({ createOfficeAvatarService: () => mocks }));
import { GET as latest, POST as upload } from "@/app/api/v1/organization/office/avatar/route";
import { GET as template } from "@/app/api/v1/organization/office/avatar-template/route";
import { GET as image } from "@/app/api/v1/organization/office/avatars/[id]/route";
import { GET as queue } from "@/app/api/v1/admin/organization/office/avatars/route";
import { PATCH as review } from "@/app/api/v1/admin/organization/office/avatars/[id]/route";
import { createAvatarTemplate } from "@/organization/office-avatar";

const ctx = { params: Promise.resolve({ id: "avatar-id" }) };
const base = "http://localhost/api/v1";
function reviewRequest(origin = "http://localhost") {
  return new Request(`${base}/admin/organization/office/avatars/avatar-id`, { method: "PATCH", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: 1, decision: "approve", note: "" }) });
}
async function uploadRequest(origin = "http://localhost") {
  const form = new FormData(); form.set("file", new File([new Uint8Array(await createAvatarTemplate())], "sprite.png", { type: "image/png" }));
  return new Request(`${base}/organization/office/avatar`, { method: "POST", headers: { origin }, body: form });
}
describe("office avatar authenticated routes", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BETTER_AUTH_URL", "http://localhost");
    mocks.identity.mockResolvedValue({ tenantId: "tenant-a", accountId: crypto.randomUUID(), user: { id: "member-a", name: "成员", role: "viewer", capabilities: [] }, roles: ["viewer"] });
    mocks.latest.mockReturnValue(null); mocks.list.mockReturnValue([]); mocks.submit.mockResolvedValue({ id: "avatar-id" }); mocks.review.mockReturnValue({ id: "avatar-id" }); mocks.read.mockReturnValue(Buffer.from("PNG"));
  });
  afterEach(() => vi.unstubAllEnvs());
  it("requires sessions for every route, including raw image and template reads", async () => {
    mocks.identity.mockResolvedValue(null);
    const results = await Promise.all([
      latest(new Request(`${base}/organization/office/avatar`)), upload(await uploadRequest()), template(new Request(`${base}/organization/office/avatar-template`)),
      image(new Request(`${base}/organization/office/avatars/avatar-id`), ctx), queue(new Request(`${base}/admin/organization/office/avatars`)), review(reviewRequest(), ctx),
    ]);
    expect(results.map(result => result.status)).toEqual([401, 401, 401, 401, 401, 401]);
    expect(mocks.latest).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });
  it("allows self-upload with the verified member and forbids viewer review/queue access", async () => {
    expect((await upload(await uploadRequest())).status).toBe(201);
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-a", memberId: "member-a", canManage: false }), expect.any(Uint8Array), undefined);
    expect((await latest(new Request(`${base}/organization/office/avatar?memberId=someone-else`))).status).toBe(200);
    expect(mocks.latest).toHaveBeenCalledWith(expect.objectContaining({ memberId: "member-a" }));
    expect((await queue(new Request(`${base}/admin/organization/office/avatars`))).status).toBe(403);
    expect((await review(reviewRequest(), ctx)).status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.review).not.toHaveBeenCalled();
  });
  it("allows administrators to review only through the scoped service", async () => {
    mocks.identity.mockResolvedValue({ tenantId: "tenant-a", accountId: crypto.randomUUID(), user: { id: "admin-a" }, roles: ["org_admin"] });
    expect((await queue(new Request(`${base}/admin/organization/office/avatars`))).status).toBe(200);
    expect((await review(reviewRequest(), ctx)).status).toBe(200);
    expect(mocks.review).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-a", memberId: "admin-a", canManage: true }), "avatar-id", { expectedVersion: 1, decision: "approve", note: "" }, undefined);
  });
  it("rejects cross-origin uploads and client identity override headers", async () => {
    expect((await upload(await uploadRequest("https://evil.example"))).status).toBe(403);
    expect((await latest(new Request(`${base}/organization/office/avatar`, { headers: { "x-tenant-id": "other" } }))).status).toBe(400);
    expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.latest).not.toHaveBeenCalled();
  });
  it("serves template and avatar PNGs with private response caching", async () => {
    const preview = await image(new Request(`${base}/organization/office/avatars/avatar-id`), ctx);
    expect(preview.status).toBe(200); expect(preview.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.read).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-a", memberId: "member-a" }), "avatar-id");
    expect((await template(new Request(`${base}/organization/office/avatar-template`))).headers.get("content-type")).toBe("image/png");
  });
});
