import { describe, expect, it, vi } from "vitest";
import { mappedError, handleCreateDiscoveryJob, handleReviewCandidate, handleRecordJudgment, handleReviewKnowledge } from "@/workbench/http";
import type { SqliteWorkbenchRepository } from "@/workbench/repository";

describe("workbench error masking", () => {
  const request = new Request("http://localhost/api/v1/projects");

  it.each([
    new Error("EACCES /private/customer/contracts secret-db-password"),
    new Error("数据库不存在：postgres://private-host/secret"),
    "secret backend failure",
  ])("masks unknown errors with status 500", async (error) => {
    const response = mappedError(request, error, "DOCUMENT_REJECTED", "上传失败，请稍后重试。");
    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatchObject({ code: "DOCUMENT_REJECTED", message: "上传失败，请稍后重试。" });
  });

  it.each([
    ["文件不能为空。", 400],
    ["负责人不是团队成员。", 400],
    ["只有草稿可以审核。", 400],
    ["版本冲突：项目已发生变化。", 409],
    ["幂等键已用于不同请求。", 409],
    ["项目不存在。", 404],
    ["机构名称已存在。", 409],
  ])("preserves known errors: %s", async (message, status) => {
    const response = mappedError(request, new Error(message), "DOCUMENT_REJECTED", "上传失败。");
    expect(response.status).toBe(status);
    expect((await response.json()).error.message).toBe(message);
  });

  const user = { id: "user-1", name: "用户", role: "投资经理", capabilities: [] };
  it.each([
    { handler: handleCreateDiscoveryJob, method: "createDiscoveryJob", body: { query: "AI chip research" } },
    { handler: handleReviewCandidate, method: "reviewCandidate", body: { decision: "reject", expectedVersion: 1 } },
    { handler: handleRecordJudgment, method: "addJudgment", body: { expectedVersion: 1, thesis: "待验证", stance: "neutral", occurredAt: "2026-09-04T00:00:00.000Z" } },
    { handler: handleReviewKnowledge, method: "reviewKnowledge", body: { decision: "approve", expectedVersion: 1 } },
  ])("preserves validation and masks repository exceptions for $method", async ({ handler, method, body }) => {
    const write = vi.fn().mockReturnValue({ id: "result-1" });
    const repository = { [method]: write } as unknown as SqliteWorkbenchRepository;
    const make = (payload: string, withKey = true) => new Request(request.url, { method: "POST", headers: withKey ? { "idempotency-key": "key-1" } : {}, body: payload });
    expect((await handler(make(JSON.stringify(body), false), repository, user, "resource-1")).status).toBe(400);
    expect((await handler(make("{broken"), repository, user, "resource-1")).status).toBe(400);
    expect((await handler(make("{}"), repository, user, "resource-1")).status).toBe(400);
    expect((await handler(make(JSON.stringify(body)), repository, user, "resource-1")).status).toBeLessThan(300);
    write.mockImplementation(() => { throw new Error("private database credentials"); });
    const failure = await handler(make(JSON.stringify(body)), repository, user, "resource-1");
    expect(failure.status).toBe(500);
    expect(await failure.text()).not.toContain("private database credentials");
  });
});
