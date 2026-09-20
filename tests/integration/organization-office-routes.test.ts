import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OfficeError } from "@/organization/office-contracts";
const mocks = vi.hoisted(() => ({ context: vi.fn(), workspace: vi.fn(), updateStyle: vi.fn(), updateProfile: vi.fn(), updateLayout: vi.fn() }));
vi.mock("@/organization/office-service", () => ({ officeContext: mocks.context }));
vi.mock("@/security/api-auth", () => ({ withApiAuth: (handler: unknown) => handler }));
import { GET } from "@/app/api/v1/organization/office/route";
import { PATCH as patchStyle } from "@/app/api/v1/organization/office/me/route";
import { PATCH as patchProfile } from "@/app/api/v1/organization/office/profile/route";
import { PATCH as patchLayout } from "@/app/api/v1/admin/organization/office/layout/route";

const request = (body: string) => new Request("http://localhost/api/v1/organization/office/me", { method: "PATCH", body });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue({ actor: { memberId: "alice" }, directory: { members: [] }, repository: { workspace: mocks.workspace, updateStyle: mocks.updateStyle, updateProfile: mocks.updateProfile, updateLayout: mocks.updateLayout } });
});
afterEach(() => vi.restoreAllMocks());
describe("office route contracts", () => {
  it("returns a private uncached workspace", async () => {
    mocks.workspace.mockReturnValue({ members: [], groups: [] });
    const result = await GET(new Request("http://localhost/api/v1/organization/office"));
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect((await result.json()).data.groups).toEqual([]);
  });
  it("passes parsed style and layout writes to the repository", async () => {
    mocks.updateStyle.mockReturnValue({ version: 2 });
    mocks.updateLayout.mockReturnValue({ layoutVersion: 2 });
    expect((await patchStyle(request('{"deskColor":"#ffffff"}'))).status).toBe(200);
    expect(mocks.updateStyle).toHaveBeenCalledWith({ memberId: "alice" }, { members: [] }, { deskColor: "#ffffff" });
    expect((await patchLayout(request('{"expectedVersion":1}'))).status).toBe(200);
    expect(mocks.updateLayout).toHaveBeenCalled();
  });
  it("passes a member profile write without accepting a target member id", async () => {
    mocks.updateProfile.mockReturnValue({ groupingMode: "project" });
    const body = '{"expectedVersion":1,"groupingMode":"project","displayedProjectId":null,"description":"尽调中","presenceStatus":"away","customStatus":""}';
    expect((await patchProfile(request(body))).status).toBe(200);
    expect(mocks.updateProfile).toHaveBeenCalledWith({ memberId: "alice" }, { members: [] }, JSON.parse(body));
  });
  it("rejects unauthenticated and forbidden contexts with their exact status", async () => {
    mocks.context.mockRejectedValue(new OfficeError(401, "AUTH_REQUIRED", "请登录"));
    expect((await GET(new Request("http://localhost"))).status).toBe(401);
    mocks.context.mockRejectedValue(new OfficeError(403, "FORBIDDEN", "无权限"));
    expect((await patchStyle(request("{}"))).status).toBe(403);
  });
  it("handles missing, invalid, over-limit bodies and schema errors", async () => {
    expect((await patchStyle(request("{"))).status).toBe(400);
    expect((await patchStyle(new Request("http://localhost", { method: "PATCH" }))).status).toBe(400);
    expect((await patchStyle(request("x".repeat(524289)))).status).toBe(413);
    mocks.updateStyle.mockImplementation(() => z.string().parse(1));
    expect((await patchStyle(request("{}"))).status).toBe(400);
  });
  it("maps conflicts and hides unexpected details", async () => {
    mocks.updateLayout.mockImplementation(() => { throw new OfficeError(409, "VERSION_CONFLICT", "布局已更新"); });
    expect((await patchLayout(request("{}"))).status).toBe(409);
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.workspace.mockImplementation(() => { throw new Error("sensitive database path"); });
    const result = await GET(new Request("http://localhost"));
    expect(result.status).toBe(500);
    expect(await result.text()).not.toContain("sensitive database path");
  });
});
