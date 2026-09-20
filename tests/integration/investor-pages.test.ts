import { beforeEach, expect, it, vi } from "vitest";
import InvestorsPage from "@/app/investors/page";
import InvestorPage from "@/app/investors/[id]/page";
import { investorProfile } from "../fixtures/investor-profile";

const { auth, list, findById, people } = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), findById: vi.fn(), people: vi.fn() }));
vi.mock("@/security/page-auth", () => ({ requirePageUser: auth }));
vi.mock("@/db/app", () => ({ getInvestorDirectoryRepository: () => ({ list, findById }), getIntelligenceRepository: () => ({ listPeople: people }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ capabilities: ["assign"] });
  list.mockReturnValue({ items: [investorProfile], total: 1 });
  findById.mockReturnValue(investorProfile);
  people.mockReturnValue([{ id: "p1", currentOrganization: "测试创投" }, { id: "p2", currentOrganization: "测试创投集团" }, { id: "p3", currentOrganization: null }]);
});
it("requires authentication before either institution page queries data", async () => {
  auth.mockRejectedValue(new Error("AUTH_REQUIRED"));
  await expect(InvestorsPage()).rejects.toThrow("AUTH_REQUIRED");
  await expect(InvestorPage({ params: Promise.resolve({ id: "inv-test" }) })).rejects.toThrow("AUTH_REQUIRED");
  expect(list).not.toHaveBeenCalled(); expect(findById).not.toHaveBeenCalled(); expect(people).not.toHaveBeenCalled();
});
it("restores the standalone directory using real institution pagination", async () => {
  const result = await InvestorsPage();
  expect(result).toBeTruthy();
  expect(list).toHaveBeenCalledWith({ perPage: 60, page: 1 });
});
it("links only exact organization matches and hides editing from read-only members", async () => {
  auth.mockResolvedValue({ capabilities: [] });
  const result = await InvestorPage({ params: Promise.resolve({ id: "inv-test" }) });
  expect(result.props).toMatchObject({ investor: investorProfile, people: [{ id: "p1", currentOrganization: "测试创投" }], canEdit: false });
  expect(findById).toHaveBeenCalledWith("inv-test");
});
it("returns 404 for a missing institution instead of redirecting into resources", async () => {
  findById.mockReturnValue(undefined);
  await expect(InvestorPage({ params: Promise.resolve({ id: "missing" }) })).rejects.toThrow("NOT_FOUND");
  expect(people).not.toHaveBeenCalled();
});
