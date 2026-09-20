import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ identity: vi.fn(), findById: vi.fn() }));
vi.mock("@/security/workspace-session", () => ({ resolveWorkspaceIdentity: mocks.identity }));
vi.mock("@/db/app", () => ({ getAppRepository: () => ({ findById: mocks.findById }) }));

import { GET } from "@/app/api/v1/projects/[id]/route";

const project = {
  id: "project-1",
  name: "测试项目",
  companyIntelligence: {
    contacts: [{ type: "work_email", value: "business@example.cn", sourceUrl: "https://company.cn/contact", verifiedAt: "2026-09-14" }],
  },
};

function identify(role: string) {
  mocks.identity.mockResolvedValue({
    user: { id: `${role}-1`, name: role, role, capabilities: [] },
    accountId: `${role}-account`, tenantId: "org-1", roles: [role],
  });
}

describe("project contact API authorization", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETTER_AUTH_URL", "https://vc.example");
    mocks.findById.mockReturnValue(project);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it("masks public work contacts for viewer roles at the API boundary", async () => {
    identify("viewer");
    const response = await GET(new Request("https://vc.example/api/v1/projects/project-1"), { params: Promise.resolve({ id: "project-1" }) });
    expect(response.status).toBe(200);
    expect((await response.json()).data.companyIntelligence.contacts).toEqual([]);
  });

  it("allows investment and research roles to read public work contacts", async () => {
    for (const role of ["org_admin", "investment_manager", "researcher"]) {
      identify(role);
      const response = await GET(new Request("https://vc.example/api/v1/projects/project-1"), { params: Promise.resolve({ id: "project-1" }) });
      expect((await response.json()).data.companyIntelligence.contacts).toEqual(project.companyIntelligence.contacts);
    }
  });
});
