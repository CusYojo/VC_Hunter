import { describe, expect, it, vi } from "vitest";
import { ModelGateway } from "@/connectors/model-gateway";
import { z } from "zod";

const schema = z.object({ value: z.string() });

function okResponse() {
  return new Response(
    JSON.stringify({
      id: "cmpl-1",
      model: "gpt-4o-mini",
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ value: "ok" }) } }],
      usage: { total_tokens: 10 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("multi-provider model gateway", () => {
  it("uses the OpenAI-compatible base URL when configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const gateway = new ModelGateway({
      provider: "openai_compatible",
      apiKey: "sk-test",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      model: "qwen-plus",
      fetchImpl: fetchMock,
    });

    const result = await gateway.generateJson({ system: "s", user: "u" }, schema);

    expect(result).toEqual({ value: "ok" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
    expect(init.headers.authorization).toBe("Bearer sk-test");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("qwen-plus");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body).not.toHaveProperty("thinking");
  });

  it("adds DeepSeek thinking-mode disable only for deepseek provider", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const gateway = new ModelGateway({
      provider: "deepseek",
      apiKey: "ds-key",
      baseUrl: "https://api.deepseek.com/chat/completions",
      model: "deepseek-v4-flash",
      fetchImpl: fetchMock,
    });

    await gateway.generateJson({ system: "s", user: "u" }, schema);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("returns provider, actual model, request id, usage and latency metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const gateway = new ModelGateway({
      provider: "openai_compatible",
      apiKey: "key",
      baseUrl: "https://api.openai.com/v1/chat/completions",
      model: "requested-model",
      fetchImpl: fetchMock,
    });

    const result = await gateway.generateStructured({ system: "s", user: "u" }, schema);

    expect(result).toMatchObject({
      data: { value: "ok" },
      lineage: {
        provider: "openai_compatible",
        requestedModel: "requested-model",
        actualModel: "gpt-4o-mini",
        providerRequestId: "cmpl-1",
        usage: { totalTokens: 10 },
      },
    });
    expect(result.lineage.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("fails closed without a key and rejects invalid JSON schema output", async () => {
    await expect(
      new ModelGateway({ provider: "deepseek", apiKey: "", baseUrl: "https://api.deepseek.com/chat/completions", model: "m" }).generateJson(
        { system: "s", user: "u" },
        schema,
      ),
    ).rejects.toThrow(/api key/i);

    const bad = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ id: "1", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ nope: true }) } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    await expect(
      new ModelGateway({ provider: "deepseek", apiKey: "k", baseUrl: "https://api.deepseek.com/chat/completions", model: "m", fetchImpl: bad }).generateJson(
        { system: "s", user: "u" },
        schema,
      ),
    ).rejects.toThrow();
  });
});
