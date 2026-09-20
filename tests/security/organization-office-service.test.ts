import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), directory: vi.fn(), assertAdmin: vi.fn() }));
vi.mock("@/auth/server", () => ({ getAuthService: () => ({ organization: { directory: mocks.directory, assertAdmin: mocks.assertAdmin } }) }));
vi.mock("@/security/workspace-session", () => ({ resolveWorkspaceIdentity: mocks.resolve }));
vi.mock("@/db/app", () => ({ getAppDatabase: () => ({}) }));
import { officeContext } from "@/organization/office-service";
import { identityScope } from "@/security/identity-scope";
const identity = { tenantId: "tenant", accountId: "account-a", roles: ["org_admin"], user: { id: "alice", name: "Alice", role: "管理员", capabilities: [] } };
const member = { id: "alice", accountId: "account-a", active: true, isPlaceholder: false, roles: ["org_admin"], name: "Alice", title: "投资经理", departmentId: "invest", version: 1, phone: "private-contact" };
beforeEach(() => { vi.resetAllMocks(); mocks.resolve.mockResolvedValue(identity); mocks.directory.mockReturnValue({ departments: [], members: [member] }); });
describe("office session and directory boundary", () => {
  it("revalidates the current membership and strips private directory fields", async () => {
    const result = await officeContext(new Request("http://localhost"));
    expect(result.actor).toEqual({ memberId: "alice", accountId: "account-a", tenantId: "tenant", canManage: true });
    expect(mocks.directory).toHaveBeenCalledWith("tenant");
    expect(mocks.assertAdmin).toHaveBeenCalledWith({ accountId: "account-a", tenantId: "tenant" });
    expect(JSON.stringify(result.directory)).not.toContain("private-contact");
    expect(result.directory.members[0]).not.toHaveProperty("roles");
  });
  it("uses verified request scope and current role state rather than stale admin claims", async () => {
    mocks.directory.mockReturnValue({ departments: [], members: [{ ...member, roles: ["viewer"] }] });
    const result = await identityScope.run(identity, () => officeContext(new Request("http://localhost")));
    expect(result.actor.canManage).toBe(false);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.assertAdmin).not.toHaveBeenCalled();
  });
  it("rejects no session, mismatched accounts, inactive and placeholder users", async () => {
    mocks.resolve.mockResolvedValue(null);
    await expect(officeContext(new Request("http://localhost"))).rejects.toMatchObject({ status: 401 });
    mocks.resolve.mockResolvedValue(identity);
    for (const patch of [{ accountId: "another" }, { active: false }, { isPlaceholder: true }]) {
      mocks.directory.mockReturnValue({ departments: [], members: [{ ...member, ...patch }] });
      await expect(officeContext(new Request("http://localhost"))).rejects.toMatchObject({ status: 403 });
    }
  });
});
