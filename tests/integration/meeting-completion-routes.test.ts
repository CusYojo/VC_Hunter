import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { WorkspaceActivityRepository } from "@/repositories/workspace-activity";
import { readOfficeWorkspace } from "@/organization/office-read-model";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), database: vi.fn() }));
vi.mock("@/security/workspace-session", () => ({ resolveWorkspaceIdentity: mocks.identity }));
vi.mock("@/db/app", () => ({ getAppDatabase: mocks.database }));
vi.mock("@/workbench/team", async () => {
  const { identityScope } = await import("@/security/identity-scope");
  return { getCurrentUser: () => ({ id: identityScope.getStore()?.user.id }), loadTeamMembers: () => ["alice", "bob", "carol", "admin"].map(id => ({ id })) };
});
import { POST } from "@/app/api/v1/activity/[id]/complete-meeting/route";
import { PATCH as respond } from "@/app/api/v1/activity/[id]/route";
let db: DatabaseSync;
let repository: WorkspaceActivityRepository;
const directory = { departments: [], members: ["alice", "bob", "carol", "admin"].map(id => ({ id, name: id, title: "员工", departmentId: null, version: 1, active: true, isPlaceholder: false })) };
const office = (id = "alice", canManage = true) => readOfficeWorkspace(db, { memberId: id, tenantId: "org", accountId: id, canManage }, directory);
const identity = (id = "alice", roles = ["investment_manager"]) => mocks.identity.mockResolvedValue({ user: { id }, accountId: `meeting-${id}`, tenantId: "org", roles });
const make = (kind = "meeting", participants = ["bob", "carol"]) => repository.create({ kind, title: "投决会议", description: "private note", participantIds: participants, dueAt: "2026-01-01T00:00:00Z" }, "alice", crypto.randomUUID());
const request = (id: string, body: unknown = { expectedVersion: 1 }, origin = "http://localhost") => new Request(`http://localhost/api/v1/activity/${id}/complete-meeting`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
const finish = (id: string, version = 1) => POST(request(id, { expectedVersion: version }), { params: Promise.resolve({ id }) });
beforeEach(() => { vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BETTER_AUTH_URL", "http://localhost"); db = createDatabase(":memory:"); initializeDatabase(db); mocks.database.mockReturnValue(db); repository = new WorkspaceActivityRepository(db, directory.members.map(member => member.id)); identity(); });
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

it("ends an actual meeting through the authenticated route and returns participants to their desks", async () => {
  const item = make();
  repository.respond(item.id, { action: "accepted", expectedVersion: 1 }, "bob");
  repository.respond(item.id, { action: "declined", expectedVersion: 2, note: "出差" }, "carol");
  expect(office().activity?.meetings).toEqual([expect.objectContaining({ id: item.id, version: 3, canEnd: true })]);
  expect(office("bob", false).activity?.meetings[0].canEnd).toBe(false);
  const response = await finish(item.id, 3);
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual({ id: item.id, version: 4, completed: true });
  expect(repository.list("alice")[0].responses).toEqual(expect.arrayContaining([expect.objectContaining({ memberId: "bob", action: "done" }), expect.objectContaining({ memberId: "carol", action: "declined", note: "出差" })]));
  expect(office().activity?.meetings).toEqual([]);
  expect(office().activity?.todos).toEqual([]);
  const notices = db.prepare("SELECT recipient_id,message FROM member_notifications WHERE kind='activity_updated'").all();
  expect(notices).toEqual([{ recipient_id: "bob", message: "会议「投决会议」已结束" }]);
  expect(db.prepare("SELECT count(*) AS count FROM workspace_activity_audit WHERE action='meeting_completed'").get()?.count).toBe(1);
  expect(JSON.stringify(await (await finish(item.id, 3)).json())).not.toContain("private note");
  expect((await finish(item.id, 4)).status).toBe(200);
  expect((await finish(item.id, 2)).status).toBe(409);
  expect(db.prepare("SELECT count(*) AS count FROM member_notifications WHERE kind='activity_updated'").get()?.count).toBe(1);
});
it("rejects participants, unrelated members, anonymous and cross-origin requests", async () => {
  const item = make();
  identity("bob"); expect((await finish(item.id)).status).toBe(403);
  identity("carol", ["viewer"]);
  expect((await finish(item.id)).status).toBe(403);
  mocks.identity.mockResolvedValue(null); expect((await finish(item.id)).status).toBe(401);
  identity(); expect((await POST(request(item.id, { expectedVersion: 1 }, "https://evil.test"), { params: Promise.resolve({ id: item.id }) })).status).toBe(403);
  expect(repository.list("alice")[0].version).toBe(1);
});
it("allows a session admin to end another creator's meeting and notifies the creator", async () => {
  const item = make(); identity("admin", ["org_admin"]);
  expect((await finish(item.id)).status).toBe(200);
  expect(db.prepare("SELECT recipient_id FROM member_notifications WHERE kind='activity_updated' ORDER BY recipient_id").all()).toEqual([{ recipient_id: "alice" }, { recipient_id: "bob" }, { recipient_id: "carol" }]);
});
it("rejects invalid versions, payloads, non-meetings and missing entities without writes", async () => {
  const item = make();
  expect((await finish(item.id, 2)).status).toBe(409);
  expect((await POST(request(item.id, { expectedVersion: 1, canManage: true }), { params: Promise.resolve({ id: item.id }) })).status).toBe(400);
  expect((await finish(item.id, 0)).status).toBe(400);
  expect((await finish(make("task").id)).status).toBe(400);
  expect((await finish("missing")).status).toBe(404);
  expect(repository.list("alice").find(row => row.id === item.id)?.version).toBe(1);
});
it("does not let a declined attendee reopen an ended meeting; deliberate rescheduling creates a fresh lifecycle", async () => {
  const item = make(); repository.respond(item.id, { action: "declined", expectedVersion: 1 }, "bob");
  expect((await finish(item.id, 2)).status).toBe(200);
  identity("bob");
  const req = new Request(`http://localhost/api/v1/activity/${item.id}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: 3, action: "accepted" }) });
  expect((await respond(req, { params: Promise.resolve({ id: item.id }) })).status).toBe(400);
  expect(office().activity?.meetings).toEqual([]);
  repository.edit(item.id, { kind: "meeting", title: "重新安排会议", participantIds: ["bob"], dueAt: "2026-01-01T00:00:00Z", expectedVersion: 3 }, "alice", "reschedule");
  expect(office().activity?.meetings).toHaveLength(1);
  identity(); expect((await finish(item.id, 3)).status).toBe(409);
  expect((await finish(item.id, 4)).status).toBe(200);
});
it("ends creator-only and adjustment-requested meetings without changing terminal responses", async () => {
  const solo = make("meeting", []); expect((await finish(solo.id)).status).toBe(200);
  const item = make(); repository.respond(item.id, { action: "change_requested", expectedVersion: 1, note: "调整时间" }, "bob");
  expect((await finish(item.id, 2)).status).toBe(200);
  expect(repository.list("alice").find(row => row.id === item.id)?.responses.find(row => row.memberId === "bob")?.action).toBe("change_requested");
  expect(office().activity?.todos).toEqual([]);
});

it("rejects malformed or oversized bodies and a session without an active employee", async () => {
  const item = make(); const params = { params: Promise.resolve({ id: item.id }) };
  const malformed = new Request(`http://localhost/api/v1/activity/${item.id}/complete-meeting`, { method: "POST", headers: { origin: "http://localhost" }, body: "{" });
  expect((await POST(malformed, params)).status).toBe(400);
  expect((await POST(request(item.id, { expectedVersion: 1, extra: "x".repeat(1024) }), params)).status).toBe(413);
  identity("unknown", ["org_admin"]); expect((await finish(item.id)).status).toBe(403);
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("VC_HUNTER_AUTH_ENABLED", "false");
  expect((await finish(item.id)).status).toBe(401);
});
it("rolls back completion, audit and notifications together if persistence fails", async () => {
  const item = make();
  db.exec("CREATE TRIGGER fail_meeting_notification BEFORE INSERT ON member_notifications WHEN NEW.kind='activity_updated' BEGIN SELECT RAISE(ABORT, 'private database failure'); END");
  const logging = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await finish(item.id); expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private database");
    expect(repository.list("alice")[0]).toMatchObject({ version: 1, responses: [expect.objectContaining({ action: "pending" }), expect.objectContaining({ action: "pending" })] });
    expect(office().activity?.meetings).toHaveLength(1);
    expect(db.prepare("SELECT count(*) AS count FROM workspace_activity_audit WHERE action='meeting_completed'").get()?.count).toBe(0);
  } finally { logging.mockRestore(); }
});
