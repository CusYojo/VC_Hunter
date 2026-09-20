import { describe, expect, it, vi } from "vitest";
import { ExaSearchProvider } from "@/connectors/web-search";

describe("Exa web search provider", () => {
  it("searches with bounded highlights and never sends credentials in the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ requestId: "exa-1", results: [{ id: "result-1", title: "芯片客户验证", url: "https://company.example/news/1", publishedDate: "2026-08-30T00:00:00Z", highlights: ["工程样品完成客户验证"] }] }), { status: 200, headers: { "content-type": "application/json" } }));
    const provider = new ExaSearchProvider("secret-key", fetchMock);

    const result = await provider.search({ query: "中国 半导体 客户验证", limit: 10 });

    expect(result.results[0]).toMatchObject({ title: "芯片客户验证", url: "https://company.example/news/1" });
    const request = fetchMock.mock.calls[0];
    expect(request[0]).toBe("https://api.exa.ai/search");
    expect(request[1].headers["x-api-key"]).toBe("secret-key");
    expect(request[1].body).not.toContain("secret-key");
  });

  it("fails closed without a key and rejects non-HTTPS result URLs", async () => {
    await expect(new ExaSearchProvider("").search({ query: "有效查询", limit: 5 })).rejects.toThrow(/api key/i);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ requestId: "exa-2", results: [{ id: "bad", title: "bad", url: "http://127.0.0.1/private", highlights: [] }] }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(new ExaSearchProvider("key", fetchMock).search({ query: "有效查询", limit: 5 })).rejects.toThrow(/https/i);
  });
});
