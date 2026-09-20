import { afterEach, expect, it, vi } from "vitest";
import { organizationRequest, organizationWrite } from "@/components/organization/api";

afterEach(() => vi.unstubAllGlobals());
it.each([[401, "登录已过期"], [403, "没有操作权限"], [409, "已被更新"], [500, "服务暂时不可用"]])("handles %i with actionable feedback", async (status, message) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({}) }));
  await expect(organizationRequest("/api/test")).rejects.toThrow(message as string);
});
it("handles malformed JSON as a failed read", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error("JSON"); } }));
  await expect(organizationRequest("/api/test")).rejects.toThrow("服务暂时不可用");
});
it("allows cancellation without replacing its AbortError", async () => {
  const error = new Error("cancel"); error.name = "AbortError";
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
  await expect(organizationRequest("/api/test")).rejects.toBe(error);
});
it("posts JSON with request identity and no cache", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { id: "d1" } }) });
  vi.stubGlobal("fetch", fetchMock);
  expect(await organizationWrite("/api/test", "POST", { name: "test" })).toEqual({ id: "d1" });
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store", method: "POST", body: '{"name":"test"}' });
});
