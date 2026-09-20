import { beforeEach, expect, it, vi } from "vitest";
import OrganizationPage from "@/app/organization/page";
import AdminPage from "@/app/admin/page";

const { requireUser, requireAdmin } = vi.hoisted(() => ({ requireUser: vi.fn(), requireAdmin: vi.fn() }));
vi.mock("@/security/page-auth", () => ({ requirePageUser: requireUser }));
vi.mock("@/organization/server", () => ({ requireOrgAdmin: requireAdmin }));
vi.mock("@/security/identity-scope", () => ({ authenticationRequired: () => true }));
vi.mock("@/db/app", () => ({ getAppDatabase: () => { throw new Error("should not load demo DB"); } }));
beforeEach(() => { vi.clearAllMocks(); requireUser.mockResolvedValue({ id: "m1" }); requireAdmin.mockResolvedValue({ accountId: "a1", tenantId: "tenant" }); });

it("requires login for the safe organization page", async () => {
  requireUser.mockRejectedValue(new Error("LOGIN"));
  await expect(OrganizationPage()).rejects.toThrow("LOGIN");
});
it("allows authenticated members only the public directory view", async () => {
  expect((await OrganizationPage()).props).toEqual({ mode: "public" });
  expect(requireAdmin).not.toHaveBeenCalled();
});
it("refuses direct admin page access unless server-side org_admin guard succeeds", async () => {
  requireAdmin.mockRejectedValue(new Error("FORBIDDEN"));
  await expect(AdminPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("FORBIDDEN");
});
it("passes only account identity to administrator UI, without credentials", async () => {
  expect((await AdminPage({ searchParams: Promise.resolve({}) })).props).toEqual({ mode: "admin", currentAccountId: "a1" });
  expect(requireUser).toHaveBeenCalled(); expect(requireAdmin).toHaveBeenCalled();
});
