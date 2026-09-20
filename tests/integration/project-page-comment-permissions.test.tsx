import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import { SqliteDealTimelineRepository } from "@/workbench/deal-timeline";
import { identityScope } from "@/security/identity-scope";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), database: vi.fn(), timeline: vi.fn(), project: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/security/page-auth", () => ({ requirePageUser: vi.fn() }));
vi.mock("@/security/workspace-session", () => ({ resolveWorkspaceIdentity: mocks.identity }));
vi.mock("@/db/app", () => ({ getAppDatabase: mocks.database, getDealTimelineRepository: mocks.timeline, getAppRepository: () => ({ findById: mocks.project }) }));
vi.mock("@/workbench/team", () => ({ loadTeamMembers: () => [] }));
vi.mock("@/components/project-360", () => ({ Project360: () => null }));
vi.mock("@/components/project-admin-editor", () => ({ ProjectAdminEditor: () => null }));
import ProjectPage from "@/app/projects/[id]/page";
let database: DatabaseSync;
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  database = createDatabase(":memory:"); initializeDatabase(database); seedDemoData(database);
  mocks.database.mockReturnValue(database); mocks.project.mockReturnValue({ id: "project-qiongxin", name: "测试项目" });
  const repository = new SqliteDealTimelineRepository(database, [{ id: "alice", name: "Alice", role: "研究员", tracks: [], subtracks: [], currentLoad: 0 }]);
  mocks.timeline.mockReturnValue(repository);
  const milestone = repository.createMilestone("project-qiongxin", { stage: "screening", title: "测试节点" }, "milestone", "alice");
  repository.addComment("project-qiongxin", { body: "本人评论", milestoneId: milestone.id }, "comment", "alice");
});
afterEach(() => { database.close(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
it.each([
  { id: "alice", roles: ["researcher"], canDelete: true },
  { id: "bob", roles: ["researcher"], canDelete: false },
  { id: "admin", roles: ["org_admin"], canDelete: true },
])("SSR projects page projects comment deletion permissions for $id", async ({ id, roles, canDelete }) => {
  mocks.identity.mockResolvedValue({ user: { id, name: id, role: "成员", capabilities: [] }, roles, accountId: `account-${id}`, tenantId: "tenant" });
  expect(identityScope.getStore()).toBeUndefined();
  const page = await ProjectPage({ params: Promise.resolve({ id: "project-qiongxin" }), searchParams: Promise.resolve({ view: "flow" }) });
  const projectView = page.props.children[1];
  expect(projectView.props.milestones[0].comments[0]).toMatchObject({ body: "本人评论", canDelete, deletedAt: null });
  expect(identityScope.getStore()).toBeUndefined();
});
