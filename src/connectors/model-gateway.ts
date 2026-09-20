import { z } from "zod";
import { isIP } from "node:net";
import { AI_PROVIDERS, getAiProvider } from "@/ai/providers";
import type { AIProviderId } from "@/ai/settings-contracts";
import { readLimitedResponseText } from "./read-limited-response";

export type ModelProvider = AIProviderId | "openai_compatible";
export interface ModelGatewayOptions {
  provider: ModelProvider; apiKey: string; baseUrl: string; model: string;
  fetchImpl?: typeof fetch; timeoutMs?: number; maxTokens?: number; allowedHosts?: readonly string[];
}
export interface GenerateInput { system: string; user: string; maxTokens?: number; temperature?: number; }
export interface ModelCallLineage {
  provider: ModelProvider; requestedModel: string; actualModel: string; providerRequestId: string | null;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number }; latencyMs: number;
}
export interface StructuredModelResult<T> { data: T; lineage: ModelCallLineage; }
export interface TextModelResult { text: string; lineage: ModelCallLineage; }
const chatResponseSchema = z.object({
  id: z.string().optional(), model: z.string().optional(),
  choices: z.array(z.object({ finish_reason: z.string(), message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional(), total_tokens: z.number().optional() }).optional(),
});
const claudeResponseSchema = z.object({
  id: z.string().optional(), model: z.string().optional(), stop_reason: z.string().nullable(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() }).optional(),
});

export class ModelGateway {
  constructor(private readonly options: ModelGatewayOptions) { validateModelEndpoint(options.provider, options.baseUrl); }
  get provider(): ModelProvider { return this.options.provider; }
  get model(): string { return this.options.model; }
  async generateJson<T>(input: GenerateInput, schema: z.ZodType<T>): Promise<T> { return (await this.generateStructured(input, schema)).data; }
  async generateStructured<T>(input: GenerateInput, schema: z.ZodType<T>): Promise<StructuredModelResult<T>> {
    const result = await this.call({ ...input, user: `${input.user}\nReturn only one valid JSON object. Do not use Markdown fences.` }, true);
    const json = result.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    return { data: schema.parse(JSON.parse(json)), lineage: result.lineage };
  }
  async generateText(input: GenerateInput): Promise<TextModelResult> { return this.call(input, false); }
  private async call(input: GenerateInput, structured: boolean): Promise<TextModelResult> {
    if (!this.options.apiKey.trim()) throw new Error("Model API key is required.");
    if (input.system.length > 20_000 || input.user.length > 200_000) throw new Error("Model prompt exceeds the size limit.");
    const startedAt = performance.now();
    const { baseUrl, apiKey, provider, fetchImpl = fetch } = this.options;
    const response = await fetchImpl(baseUrl, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(Math.min(120_000, Math.max(1, this.options.timeoutMs ?? 60_000))),
      headers: provider === "claude" ? { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" } : { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(this.requestBody(input, structured)),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error("Model request failed."); }
    if (response.headers.get("content-type")?.split(";", 1)[0] !== "application/json") { await response.body?.cancel(); throw new Error("Model returned an invalid content type."); }
    const raw = JSON.parse(await readLimitedResponseText(response, 4_194_304, "Model response exceeded the byte limit."));
    const parsed = provider === "claude" ? parseClaude(raw) : parseChat(raw);
    return { text: parsed.text, lineage: { provider, requestedModel: this.model, actualModel: parsed.model ?? this.model, providerRequestId: parsed.id ?? null, usage: parsed.usage, latencyMs: Math.max(0, Math.round(performance.now() - startedAt)) } };
  }
  private requestBody(input: GenerateInput, structured: boolean) {
    const { provider, model } = this.options;
    const maxTokens = Math.min(32_768, Math.max(1, input.maxTokens ?? this.options.maxTokens ?? 8_192));
    if (provider === "claude") return { model, max_tokens: maxTokens, system: input.system, messages: [{ role: "user", content: input.user }], stream: false };
    const reasoningOpenAI = (provider === "openai" || provider === "openai_compatible") && /^(gpt-5|o[1-9])/.test(model);
    const kimiK3 = provider === "kimi" && model === "kimi-k3";
    const requiredGlmThinking = provider === "glm" && ["glm-5.3", "glm-5.3-flash"].includes(model);
    return {
      model, stream: false, ...(reasoningOpenAI || kimiK3 ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
      ...(provider === "deepseek" ? { thinking: { type: "disabled" } } : {}),
      ...(provider === "qwen" ? { enable_thinking: false } : {}),
      ...(provider === "kimi" && /^kimi-k2\.[56]/.test(model) ? { thinking: { type: "disabled" } } : {}),
      // GLM 5.3 requires reasoning; low is the documented migration from disabled thinking.
      ...(provider === "glm" ? requiredGlmThinking ? { thinking: { type: "enabled" }, reasoning_effort: "low" } : { thinking: { type: "disabled" } } : {}),
      // Sampling and JSON-mode support vary on reasoning models. Prompt + schema validation works across all six protocols.
      ...(structured && (provider === "deepseek" || provider === "openai_compatible") && !reasoningOpenAI ? { response_format: { type: "json_object" } } : {}),
      messages: [{ role: "system", content: input.system }, { role: "user", content: input.user }],
    };
  }
}
function parseChat(raw: unknown) {
  const data = chatResponseSchema.parse(raw); const choice = data.choices[0];
  if (choice.finish_reason !== "stop" || !choice.message.content?.trim()) throw new Error("Model returned an incomplete response.");
  return { text: choice.message.content, id: data.id, model: data.model, usage: { ...(data.usage?.prompt_tokens === undefined ? {} : { inputTokens: data.usage.prompt_tokens }), ...(data.usage?.completion_tokens === undefined ? {} : { outputTokens: data.usage.completion_tokens }), ...(data.usage?.total_tokens === undefined ? {} : { totalTokens: data.usage.total_tokens }) } };
}
function parseClaude(raw: unknown) {
  const data = claudeResponseSchema.parse(raw); const text = data.content.filter((item) => item.type === "text").map((item) => item.text ?? "").join("");
  if (!["end_turn", "stop_sequence"].includes(data.stop_reason ?? "") || !text.trim()) throw new Error("Model returned an incomplete response.");
  return { text, id: data.id, model: data.model, usage: { ...(data.usage?.input_tokens === undefined ? {} : { inputTokens: data.usage.input_tokens }), ...(data.usage?.output_tokens === undefined ? {} : { outputTokens: data.usage.output_tokens }) } };
}
export function resolveModelGateway(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): ModelGateway {
  const provider: ModelProvider = env.MODEL_PROVIDER === "openai_compatible" ? "openai_compatible" : AI_PROVIDERS.find((item) => item.id === env.MODEL_PROVIDER)?.id ?? "deepseek";
  const catalog = getAiProvider(provider === "openai_compatible" ? "openai" : provider);
  const apiKey = provider === "deepseek" ? env.DEEPSEEK_API_KEY ?? "" : env.MODEL_API_KEY ?? env.OPENAI_API_KEY ?? "";
  return new ModelGateway({ provider, apiKey, baseUrl: env.MODEL_BASE_URL ?? catalog.endpoint, model: env.MODEL_NAME ?? catalog.defaultModel, fetchImpl });
}
function validateModelEndpoint(provider: ModelProvider, rawUrl: string): void {
  const url = new URL(rawUrl);
  const approved = provider === "openai_compatible" ? AI_PROVIDERS.filter((item) => item.id !== "claude").map((item) => item.endpoint) : [getAiProvider(provider).endpoint];
  if (url.protocol !== "https:" || url.username || url.password || isIP(url.hostname) || !approved.includes(url.href)) throw new Error("Model endpoint is not in the approved HTTPS host allowlist.");
}
