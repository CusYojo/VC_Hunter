import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ identity: vi.fn(), list: vi.fn(), countUnread: vi.fn(), mark: vi.fn(), markAll: vi.fn() }));
vi.mock("@/security/workspace-session", () => ({ resolveWorkspaceIdentity: mocks.identity }));
vi.mock("@/db/app", () => ({ getDealTimelineRepository: () => ({ listNotifications: mocks.list, countUnread: mocks.countUnread, markNotification: mocks.mark, markAllNotificationsRead: mocks.markAll }) }));
vi.mock("@/auth/server", () => ({ getAuthService: vi.fn() }));
import * as notificationsRoute from "@/app/api/v1/notifications/route";
import { PATCH as markOne } from "@/app/api/v1/notifications/[id]/route";

const snapshotAt = "2026-09-04T08:00:00.000Z";
const identity = (id = "member-1", role = "viewer") => ({ user: { id, name: "成员", role: "成员", capabilities: [] }, accountId: crypto.randomUUID(), tenantId: "org-1", roles: [role] });
function patch(body: unknown, path = "", origin = "http://localhost") {
  return new Request(`http://localhost/api/v1/notifications${path}`, { method: "PATCH", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
}
const markAll = notificationsRoute.PATCH;

describe("notification API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost");
    mocks.identity.mockResolvedValue(identity());
    mocks.list.mockReturnValue([{ id: "notification-1" }]);
    mocks.countUnread.mockReturnValue(3);
    mocks.markAll.mockReturnValue({ updated: 2 });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns a snapshot and scopes list/count to the verified member", async () => {
    const started = Date.now();
    const response = await notificationsRoute.GET(new Request("http://localhost/api/v1/notifications?recipientId=another-user&limit=200&unread=true"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const { data } = await response.json();
    expect(data).toMatchObject({ recipientId: "member-1", total: 1, unread: 3 });
    expect(Date.parse(data.snapshotAt)).toBeGreaterThanOrEqual(started);
    expect(Date.parse(data.snapshotAt)).toBeLessThanOrEqual(Date.now());
    expect(mocks.list).toHaveBeenCalledWith("member-1", { unreadOnly: true, limit: 200 });
    expect(mocks.countUnread).toHaveBeenCalledWith("member-1");
  });
  it.each(["", "0", "-1", "201", "1.5", "12garbage", "1e2", " 2", "2 ", "Infinity"])("rejects invalid limit %j", async limit => {
    const response = await notificationsRoute.GET(new Request(`http://localhost/api/v1/notifications?limit=${encodeURIComponent(limit)}`));
    expect(response.status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("supports omitted limit", async () => {
    expect((await notificationsRoute.GET(new Request("http://localhost/api/v1/notifications"))).status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith("member-1", { unreadOnly: false, limit: undefined });
  });
  it.each(["org_admin", "investment_manager", "researcher", "viewer", "compliance_reviewer"])("allows %s to mark their snapshot read", async role => {
    mocks.identity.mockResolvedValue(identity("member-2", role));
    const response = await markAll(patch({ before: snapshotAt }));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ updated: 2 });
    expect(mocks.markAll).toHaveBeenCalledWith("member-2", snapshotAt);
  });
  it.each([{}, { before: "not-a-date" }, { before: "2026-09-04" }, { before: "2026-02-30T08:00:00.000Z" }, { before: snapshotAt, recipientId: "another-user" }])("rejects invalid snapshot input %j", async body => {
    expect((await markAll(patch(body))).status).toBe(400);
    expect(mocks.markAll).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated reads and mutations", async () => {
    mocks.identity.mockResolvedValue(null);
    expect((await notificationsRoute.GET(new Request("http://localhost/api/v1/notifications"))).status).toBe(401);
    expect((await markAll(patch({ before: snapshotAt }))).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.markAll).not.toHaveBeenCalled();
  });
  it("rejects cross-origin bulk mutations", async () => {
    expect((await markAll(patch({ before: snapshotAt }, "", "https://untrusted.example"))).status).toBe(403);
    expect(mocks.markAll).not.toHaveBeenCalled();
  });
  it("does not allow a body recipient to override the verified member", async () => {
    expect((await markOne(patch({ read: true, recipientId: "another-user" }, "/notice-1"), { params: Promise.resolve({ id: "notice-1" }) })).status).toBe(400);
    expect(mocks.mark).not.toHaveBeenCalled();
  });
  it("passes the session identity to single-notification updates", async () => {
    mocks.mark.mockReturnValue({ id: "notice-1", readAt: snapshotAt });
    const response = await markOne(patch({ read: true }, "/notice-1"), { params: Promise.resolve({ id: "notice-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.mark).toHaveBeenCalledWith("member-1", "notice-1", true);
    expect((await response.json()).data).toMatchObject({ id: "notice-1", readAt: snapshotAt, unread: 3 });
    expect(mocks.countUnread).toHaveBeenCalledWith("member-1");
  });
  it("validates single-notification read state", async () => {
    expect((await markOne(patch({ read: "true" }, "/notice-1"), { params: Promise.resolve({ id: "notice-1" }) })).status).toBe(400);
    expect(mocks.mark).not.toHaveBeenCalled();
  });
  it("returns not-found for another member's notification", async () => {
    mocks.mark.mockImplementation(() => { throw new Error("提醒不存在。"); });
    expect((await markOne(patch({ read: true }, "/foreign-notice"), { params: Promise.resolve({ id: "foreign-notice" }) })).status).toBe(404);
    expect(mocks.mark).toHaveBeenCalledWith("member-1", "foreign-notice", true);
  });
  it("rejects malformed bulk JSON", async () => {
    const request = new Request("http://localhost/api/v1/notifications", { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body: "{" });
    expect((await markAll(request)).status).toBe(400);
    expect(mocks.markAll).not.toHaveBeenCalled();
  });
  it("masks unexpected bulk update failures", async () => {
    mocks.markAll.mockImplementation(() => { throw new Error("private database path"); });
    const response = await markAll(patch({ before: snapshotAt }));
    expect(response.status).toBe(500);
    expect((await response.json()).error.message).toBe("更新提醒失败。");
  });
});
