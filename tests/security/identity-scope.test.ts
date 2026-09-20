import { afterEach, describe, expect, it, vi } from "vitest";
import { getCurrentUser, getCurrentTenantId, loadTeamMembers } from "@/workbench/team";
import { identityScope } from "@/security/identity-scope";

afterEach(() => vi.unstubAllEnvs());
describe("request identity", () => {
  it("never substitutes demo team members when authenticated configuration is missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => loadTeamMembers("/nonexistent-vc-hunter-team-file.json")).toThrow("团队成员配置");
  });
  it("fails closed in production without a verified request", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => getCurrentUser()).toThrow();
  });
  it("uses verified identity instead of server-wide demo user", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const user = { id: "actual-member", name: "真实用户", role: "投资经理", capabilities: [] };
    await identityScope.run({ user, tenantId: "org-1", accountId: "account-1", roles: ["investment_manager"] }, async () => {
      await Promise.resolve();
      expect(getCurrentUser()).toEqual(user);
      expect(getCurrentTenantId()).toBe("org-1");
    });
  });
});
