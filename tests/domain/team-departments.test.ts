import { expect, it, vi } from "vitest";
import { loadTeamMembers } from "@/workbench/team";
import { teamMemberSchema } from "@/workbench/contracts";
const directory = vi.hoisted(() => vi.fn());
vi.mock("@/auth/server", () => ({ getAuthService: () => ({ organization: { directory } }) }));
vi.mock("@/security/identity-scope", () => ({ authenticationRequired: () => true, identityScope: { getStore: () => ({ tenantId: "workspace-a" }) } }));
it("maps department names from organization records, never from personal names or titles", () => {
  const member = { id: "a", accountId: "account-a", name: "示例经理", title: "投资经理", active: true, isPlaceholder: false };
  directory.mockReturnValue({ departments: [{ id: "d1", name: "投资一部" }], members: [{ ...member, departmentId: "d1" }, { ...member, id: "b", departmentId: null }, { ...member, id: "c", departmentId: "missing" }, { ...member, id: "inactive", active: false }, { ...member, id: "placeholder", isPlaceholder: true }] });
  const members = loadTeamMembers();
  expect(directory).toHaveBeenCalledWith("workspace-a");
  expect(members).toHaveLength(3);
  expect(members[0]).toMatchObject({ departmentId: "d1", departmentName: "投资一部" });
  expect(members[1]).toMatchObject({ departmentId: null, departmentName: null });
  expect(members[2]).toMatchObject({ departmentId: "missing", departmentName: null });
  expect(() => teamMemberSchema.parse(members[0])).not.toThrow();
});
