import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ModelGateway } from "@/connectors/model-gateway";
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
describe("personal model protocols", () => {
  it("uses native Claude Messages and extracts only text blocks", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ id: "msg-1", model: "claude-sonnet-5", stop_reason: "end_turn", content: [{ type: "thinking", thinking: "private" }, { type: "text", text: '{"ok":true}' }], usage: { input_tokens: 3, output_tokens: 5 } }));
    const gateway = new ModelGateway({ provider: "claude", apiKey: "test-key", model: "claude-sonnet-5", baseUrl: "https://api.anthropic.com/v1/messages", fetchImpl });
    expect((await gateway.generateStructured({ system: "Return JSON", user: "go", temperature: 0.1 }, z.object({ ok: z.boolean() }))).data).toEqual({ ok: true });
    const init = fetchImpl.mock.calls[0][1];
    expect(init.headers["x-api-key"]).toBe("test-key"); expect(init.headers["anthropic-version"]).toBe("2023-06-01");
    expect(init.redirect).toBe("error");
    const body = JSON.parse(init.body); expect(body.system).toContain("Return JSON"); expect(body).not.toHaveProperty("temperature"); expect(body).not.toHaveProperty("response_format");
  });
  it("supports plain GPT reasoning responses without unsupported parameters", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ choices: [{ finish_reason: "stop", message: { content: "hello" } }] }));
    const gateway = new ModelGateway({ provider: "openai", apiKey: "test", model: "gpt-5.4", baseUrl: "https://api.openai.com/v1/chat/completions", fetchImpl });
    expect((await gateway.generateText({ system: "s", user: "u", temperature: 0.2 })).text).toBe("hello");
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.max_completion_tokens).toBeGreaterThan(0); expect(body).not.toHaveProperty("max_tokens"); expect(body).not.toHaveProperty("temperature"); expect(body).not.toHaveProperty("response_format");
  });
  it("rejects a cross-provider endpoint even on an otherwise official host", () => {
    expect(() => new ModelGateway({ provider: "claude", apiKey: "key", model: "m", baseUrl: "https://api.openai.com/v1/chat/completions" })).toThrow();
  });
  it("rejects incomplete Claude output", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ stop_reason: "max_tokens", content: [{ type: "text", text: "partial" }] }));
    await expect(new ModelGateway({ provider: "claude", apiKey: "k", model: "m", baseUrl: "https://api.anthropic.com/v1/messages", fetchImpl }).generateText({ system: "s", user: "u" })).rejects.toThrow(/incomplete/);
  });
});
