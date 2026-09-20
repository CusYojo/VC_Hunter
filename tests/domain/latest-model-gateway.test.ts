import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { getAiProvider } from "@/ai/providers";
import { ModelGateway, resolveModelGateway, type ModelProvider } from "@/connectors/model-gateway";

async function captureRequest(provider: ModelProvider, model: string, structured = false) {
  const fetchMock = vi.fn().mockResolvedValue(Response.json(provider === "claude" ? {
    model, stop_reason: "end_turn", content: [{ type: "thinking", thinking: "private reasoning" }, { type: "text", text: '{"answer":"ok"}' }],
  } : {
    model, choices: [{ finish_reason: "stop", message: { content: '{"answer":"ok"}', reasoning_content: "private reasoning" } }],
  }));
  const gateway = new ModelGateway({ provider, model, apiKey: "isolated-unit-fixture-key", baseUrl: getAiProvider(provider === "openai_compatible" ? "openai" : provider).endpoint, fetchImpl: fetchMock });
  const input = { system: "Answer concisely.", user: "Check the selected model.", maxTokens: 4096, temperature: 0.2 };
  const result = structured
    ? await gateway.generateStructured(input, z.object({ answer: z.string() }))
    : await gateway.generateText(input);
  expect(result.lineage.requestedModel).toBe(model);
  expect(result.lineage.actualModel).toBe(model);
  expect(JSON.stringify(result)).not.toContain("private reasoning");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body.model).toBe(model);
  for (const field of ["temperature", "top_p", "top_k", "presence_penalty", "frequency_penalty", "n"]) expect(body).not.toHaveProperty(field);
  return body;
}

describe("latest provider model request compatibility", () => {
  it("resolves current catalog defaults without changing saved model overrides", () => {
    expect(resolveModelGateway({ NODE_ENV: "test" }).model).toBe(getAiProvider("deepseek").defaultModel);
    expect(resolveModelGateway({ NODE_ENV: "test", MODEL_PROVIDER: "kimi" }).model).toBe(getAiProvider("kimi").defaultModel);
    const saved = resolveModelGateway({ NODE_ENV: "test", MODEL_PROVIDER: "openai_compatible", MODEL_NAME: "gpt-5.6-terra", MODEL_API_KEY: "fixture-key", MODEL_BASE_URL: getAiProvider("openai").endpoint });
    expect(saved.provider).toBe("openai_compatible");
    expect(saved.model).toBe("gpt-5.6-terra");
  });

  it("calls the configured official endpoint with the saved model and key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ choices: [{ finish_reason: "stop", message: { content: "ok" } }] }));
    const gateway = resolveModelGateway({ NODE_ENV: "test", MODEL_PROVIDER: "openai", OPENAI_API_KEY: "isolated-unit-openai-key", MODEL_NAME: "gpt-5.6-sol" }, fetchMock);
    expect(gateway.provider).toBe("openai");
    await gateway.generateText({ system: "s", user: "u" });
    expect(fetchMock.mock.calls[0][0]).toBe(getAiProvider("openai").endpoint);
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe("Bearer isolated-unit-openai-key");
  });

  it.each(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"])("preserves %s and sends completion-token limits", async (model) => {
    for (const structured of [false, true]) {
      const body = await captureRequest("openai", model, structured);
      expect(body.max_completion_tokens).toBe(4096);
      expect(body).not.toHaveProperty("max_tokens");
      expect(body).not.toHaveProperty("thinking");
      expect(body).not.toHaveProperty("response_format");
    }
  });

  it("uses Kimi K3 completion-token limits without disabling its mandatory thinking", async () => {
    for (const structured of [false, true]) {
      const body = await captureRequest("kimi", "kimi-k3", structured);
      expect(body.max_completion_tokens).toBe(4096);
      expect(body).not.toHaveProperty("max_tokens");
      expect(body).not.toHaveProperty("thinking");
      expect(body).not.toHaveProperty("reasoning_effort");
    }
  });

  it.each(["kimi-k2.7-code", "kimi-k2.7-code-highspeed"])("preserves mandatory thinking and max_tokens for %s", async (model) => {
    const body = await captureRequest("kimi", model);
    expect(body.max_tokens).toBe(4096);
    expect(body).not.toHaveProperty("max_completion_tokens");
    expect(body).not.toHaveProperty("thinking");
  });

  it.each(["glm-5.3", "glm-5.3-flash"])("uses required thinking and migration effort for %s", async (model) => {
    const body = await captureRequest("glm", model);
    expect(body.max_tokens).toBe(4096);
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBe("low");
  });

  it.each(["kimi-k2.5", "kimi-k2.6"])("preserves saved legacy Kimi %s parameters", async (model) => {
    const body = await captureRequest("kimi", model);
    expect(body.max_tokens).toBe(4096);
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it.each(["glm-5.2", "glm-4.7", "glm-5.30-custom"])("leaves other GLM %s parameters unchanged", async (model) => {
    const body = await captureRequest("glm", model);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("keeps Claude Fable adaptive thinking implicit and separates final text", async () => {
    const body = await captureRequest("claude", "claude-fable-5-1");
    expect(body.max_tokens).toBe(4096);
    expect(body).not.toHaveProperty("thinking");
  });

  it("preserves DeepSeek and Qwen non-thinking requests", async () => {
    const deepseek = await captureRequest("deepseek", "deepseek-v4-pro");
    expect(deepseek.thinking).toEqual({ type: "disabled" });
    const qwen = await captureRequest("qwen", "qwen3.8-flash");
    expect(qwen.enable_thinking).toBe(false);
  });
});
