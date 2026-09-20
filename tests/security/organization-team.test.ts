import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { directory } = vi.hoisted(() => ({ directory: vi.fn() }));
vi.mock("@/auth/server", () => ({ getAuthService: () => ({ organization: { directory } }) }));
import { loadTeamMembers, suggestOwner } from "@/workbench/team";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { identityScope } from "@/security/identity-scope";

beforeEach(() => {
  vi.stubEnv("VC_HUNTER_AUTH_ENABLED", "true");
  vi.stubEnv("VC_HUNTER_CURRENT_TENANT_ID", "vc-hunter");
  directory.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("organization-backed project team", () => {
  it("uses current active account holders, without contacts or placeholders", () => {
    directory.mockReturnValue({ departments: [], members: [
      { id: "person-1", name: "真实成员", title: "投资经理", active: true, accountId: "account-1", isPlaceholder: false, departmentId: null, phone: "private" },
      { id: "placeholder", active: true, accountId: null, isPlaceholder: true },
      { id: "disabled", active: false, accountId: "account-2", isPlaceholder: false },
    ] });
    expect(loadTeamMembers()).toEqual([{ id: "person-1", name: "真实成员", role: "投资经理", tracks: [], subtracks: [], currentLoad: 0, assignmentProfileKnown: false, departmentId: null, departmentName: null }]);
    expect(suggestOwner(loadTeamMembers(), { track: "AI", subtrack: "" })).toBeUndefined();
    expect(directory).toHaveBeenCalledWith("vc-hunter");
    directory.mockReturnValue({ departments: [], members: [{ id: "person-1", active: false, accountId: "account-1" }] });
    expect(loadTeamMembers()).toEqual([]);
  });
  it("selects the verified tenant and propagates database errors", () => {
    directory.mockReturnValue({ departments: [], members: [{ id: "person-1", name: "成员", title: "", active: true, accountId: "account-1", isPlaceholder: false }] });
    identityScope.run({ tenantId: "verified", accountId: "account-1", roles: [], user: { id: "person-1", name: "成员", role: "成员", capabilities: [] } }, () => {
      expect(loadTeamMembers()[0].role).toBe("成员");
      expect(directory).toHaveBeenCalledWith("verified");
    });
    directory.mockImplementation(() => { throw new Error("database unavailable"); });
    expect(() => loadTeamMembers()).toThrow("database unavailable");
  });
  it("retains explicit legacy config behavior without opening the auth database", () => {
    expect(() => loadTeamMembers("/nonexistent-vc-hunter-team.json")).toThrow("团队成员配置");
    expect(directory).not.toHaveBeenCalled();
  });
  it("uses the configured real team during the empty-directory migration window", () => {
    const dir = mkdtempSync(join(tmpdir(), "vc-team-fallback-"));
    const member = { id: "existing", name: "真实人员", role: "投资经理", tracks: ["AI"], subtracks: [], currentLoad: 2 };
    try {
      const path = join(dir, "team.json");
      writeFileSync(path, JSON.stringify([member]));
      vi.stubEnv("VC_HUNTER_TEAM_CONFIG", path);
      directory.mockReturnValue({ departments: [], members: [] });
      expect(loadTeamMembers()).toEqual([member]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
