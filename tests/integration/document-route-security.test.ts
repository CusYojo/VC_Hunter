import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ upload: vi.fn(), list: vi.fn(), identity: vi.fn() }));
vi.mock("@/security/workspace-session", () => ({ resolveWorkspaceIdentity: mocks.identity }));
vi.mock("@/db/app", () => ({ getAppDatabase: () => ({}) }));
vi.mock("@/workbench/team", () => ({ getCurrentUser: () => ({ id: "user-1" }) }));
vi.mock("@/workbench/documents", () => ({ uploadProjectDocument: mocks.upload, listProjectDocuments: mocks.list }));
import { GET, POST } from "@/app/api/v1/projects/[id]/documents/route";

const context = { params: Promise.resolve({ id: "project-1" }) };
function uploadRequest(externalPolicy = "local_only") {
  const form = new FormData();
  form.set("file", new File(["private text"], "deal.txt", { type: "text/plain" }));
  form.set("expectedVersion", "1");
  form.set("externalPolicy", externalPolicy);
  return new Request("http://localhost/api/v1/projects/project-1/documents", { method: "POST", headers: { "idempotency-key": "upload-1", origin: "http://localhost" }, body: form });
}

describe("document API security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost");
    mocks.identity.mockResolvedValue({ user: { id: "user-1" }, accountId: crypto.randomUUID(), tenantId: "org-1", roles: ["investment_manager"] });
    mocks.upload.mockResolvedValue({ id: "doc-1", externalPolicy: "local_only" });
  });
  afterEach(() => vi.unstubAllEnvs());
  it("does not touch private documents without a verified session", async () => {
    mocks.identity.mockResolvedValue(null);
    expect((await POST(uploadRequest(), context)).status).toBe(401);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect((await GET(new Request("http://localhost/api/v1/projects/project-1/documents"), context)).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("rejects external upload permission before calling storage", async () => {
    const response = await POST(uploadRequest("external_allowed"), context);
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe("资料外发暂未开放，仅支持本地分析。");
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("accepts local-only uploads without exposing storage keys", async () => {
    mocks.upload.mockResolvedValue({ id: "doc-1", externalPolicy: "local_only", storageKey: "internal-filename.txt" });
    const response = await POST(uploadRequest(), context);
    expect(response.status).toBe(201);
    expect((await response.json()).data).not.toHaveProperty("storageKey");
    expect(mocks.upload).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ externalPolicy: "local_only" }));
  });
  it.each([["文件不能为空。", 400], ["版本冲突：项目已发生变化。", 409], ["EACCES /private/secret-key", 500]])("maps upload errors: %s", async (message, status) => {
    mocks.upload.mockRejectedValue(new Error(message));
    const response = await POST(uploadRequest(), context);
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body.error.message).toBe(status === 500 ? "上传失败，请稍后重试。" : message);
  });
  it("masks document listing failures", async () => {
    mocks.list.mockImplementation(() => { throw new Error("database secret pathname"); });
    const response = await GET(new Request("http://localhost/api/v1/projects/project-1/documents"), context);
    expect(response.status).toBe(500);
    expect((await response.json()).error.message).toBe("读取资料失败，请稍后重试。");
  });
});
