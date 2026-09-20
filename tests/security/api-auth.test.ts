import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const resolveIdentity = vi.hoisted(() => vi.fn());
vi.mock("@/security/workspace-session", () => ({ resolveWorkspaceIdentity: resolveIdentity }));
import { withApiAuth } from "@/security/api-auth";
import { getCurrentUser } from "@/workbench/team";

const identity = { user: { id: "member-1", name: "个人账号", role: "投资经理", capabilities: [] }, accountId: "account-1", tenantId: "org-1", roles: ["investment_manager"] };
beforeEach(() => { vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BETTER_AUTH_URL", "https://vc.example"); resolveIdentity.mockReset(); resolveIdentity.mockResolvedValue(identity); });
afterEach(() => vi.unstubAllEnvs());
describe("API request session enforcement", () => {
  it("does not invoke data access for anonymous users", async () => {
    resolveIdentity.mockResolvedValue(null);
    const handler = vi.fn();
    expect((await withApiAuth(handler)(new Request("https://vc.example/api/v1/projects"))).status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });
  it("passes the real actor into existing business handlers", async () => {
    const response = await withApiAuth(() => Response.json(getCurrentUser()))(new Request("https://vc.example/api/v1/projects"));
    expect(await response.json()).toEqual(identity.user);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("rejects forged identity headers before querying sessions", async () => {
    const response = await withApiAuth(vi.fn())(new Request("https://vc.example/api/v1/projects", { headers: { "x-user-id": "admin" } }));
    expect(response.status).toBe(400);
    expect(resolveIdentity).not.toHaveBeenCalled();
  });
  it("rejects viewer writes and cross-origin writes", async () => {
    resolveIdentity.mockResolvedValue({ ...identity, roles: ["viewer"] });
    const handler = vi.fn();
    const request = (origin: string) => new Request("https://vc.example/api/v1/investors", { method: "POST", headers: { origin } });
    expect((await withApiAuth(handler)(request("https://vc.example"))).status).toBe(403);
    resolveIdentity.mockResolvedValue(identity);
    expect((await withApiAuth(handler)(request("https://evil.test"))).status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });
  it("masks unexpected storage errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await withApiAuth(() => { throw new Error("secret database path"); })(new Request("https://vc.example/api/v1/projects"));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret");
    vi.restoreAllMocks();
  });
  it("applies the stricter expensive-operation limit to discovery imports", async () => {
    resolveIdentity.mockResolvedValue({ ...identity, accountId: "bulk-import-account", roles: ["org_admin"] });
    const handler = vi.fn(() => new Response(null, { status: 204 }));
    const request = () => new Request("https://vc.example/api/v1/discovery/imports/preview", { method: "POST", headers: { origin: "https://vc.example" } });
    for (let index = 0; index < 5; index += 1) expect((await withApiAuth(handler)(request())).status).toBe(204);
    expect((await withApiAuth(handler)(request())).status).toBe(429);
  });
});
