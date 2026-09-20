import { describe, expect, it, vi } from "vitest";
import { DeepSeekWebSearchProvider } from "@/connectors/web-search";

describe("DeepSeek web search provider", () => {
  it("forces server-side web search and returns structured discovery leads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "resp-search-1",
      status: "completed",
      output: [{
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{
          type: "output_text",
          text: JSON.stringify({ results: [{
            title: "某芯片公司完成融资",
            url: "https://company.example/news/1",
            publishedAt: "2026-08-30T00:00:00Z",
            highlights: ["深创投参与本轮融资"],
          }] }),
        }],
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const provider = new DeepSeekWebSearchProvider("deepseek-secret", fetchMock, "deepseek-v4-flash");

    const result = await provider.search({ query: "中国 半导体 投资 融资", limit: 10 });

    expect(result).toMatchObject({
      providerRequestId: "resp-search-1",
      results: [{ title: "某芯片公司完成融资", url: "https://company.example/news/1", highlights: ["深创投参与本轮融资"] }],
      lineage: { provider: "deepseek-web-search", requestedModel: "deepseek-v4-flash", actualModel: "deepseek-v4-flash", prompt: { id: "investment-web-search", version: "1.0.0" } },
    });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.deepseek.com/responses");
    expect(options.headers.authorization).toBe("Bearer deepseek-secret");
    expect(options.body).not.toContain("deepseek-secret");
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({
      model: "deepseek-v4-flash",
      tools: [{ type: "web_search" }],
      tool_choice: { type: "web_search" },
    });
    expect(body.instructions).toContain("只输出 JSON");
  });

  it("fails closed without a key and rejects non-HTTPS model output", async () => {
    await expect(new DeepSeekWebSearchProvider("").search({ query: "有效查询", limit: 5 })).rejects.toThrow(/api key/i);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "resp-search-2",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({
        results: [{ title: "bad", url: "http://127.0.0.1/private", publishedAt: null, highlights: [] }],
      }) }] }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(new DeepSeekWebSearchProvider("key", fetchMock).search({ query: "有效查询", limit: 5 })).rejects.toThrow(/https/i);
  });

  it("accepts bounded HTTPS links when web search returns a Chinese markdown summary", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "resp-search-markdown",
      status: "completed",
      output: [{ type: "message", content: [{
        type: "output_text",
        text: "根据联网搜索结果：\n1. [智平方完成新一轮融资](https://company.example/news/round-a)：深创投领投过亿元。",
      }] }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const result = await new DeepSeekWebSearchProvider("key", fetchMock).search({ query: "深创投 投资", limit: 5 });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      title: "智平方完成新一轮融资",
      url: "https://company.example/news/round-a",
    });
    expect(result.results[0].highlights[0]).toContain("深创投领投");
  });

  it("retries one transient malformed response and then succeeds", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "bad", status: "completed", output: [] }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "good",
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({
          results: [{ title: "项目融资", url: "https://company.example/news/2", publishedAt: null, highlights: ["机构参与融资"] }],
        }) }] }],
      }), { status: 200, headers: { "content-type": "application/json" } }));

    const result = await new DeepSeekWebSearchProvider("key", fetchMock).search({ query: "机构投资", limit: 5 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.providerRequestId).toBe("good");
  });

  it("uses an injected versioned prompt module", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "custom", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ results: [] }) }] }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const prompt = {
      id: "investment-web-search", version: "2.0.0", hash: "hash", system: "CUSTOM SEARCH RULE",
      renderUser: () => "unused", render: ({ query, limit }: { query: string; limit: number }) => ({ system: "CUSTOM SEARCH RULE", user: `CUSTOM ${limit} ${query}`, maxTokens: 123 }),
    };

    await new DeepSeekWebSearchProvider("key", fetchMock, "model", prompt).search({ query: "机构投资", limit: 3 });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.instructions).toBe("CUSTOM SEARCH RULE");
    expect(body.input).toBe("CUSTOM 3 机构投资");
    expect(body.max_output_tokens).toBe(123);
  });
});
