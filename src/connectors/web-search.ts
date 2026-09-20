import { normalizeNewsPublishedAt, type PublicationWindow } from "@/domain/news-publication";
import { z } from "zod";
import { createHash } from "node:crypto";
import { readLimitedResponseText } from "./read-limited-response";
import { createBuiltinPromptRegistry, PROMPT_REFS } from "@/prompts/catalog";
import type { ResolvedPrompt } from "@/prompts/contract";

export interface WebSearchResult { externalId: string; title: string; url: string; publishedAt: string | null; highlights: string[]; publicationVerifiedAt?: string; }
export interface WebSearchLineage {
  provider: string;
  prompt?: { id: string; version: string; hash: string };
  requestedModel?: string;
  actualModel?: string;
  providerRequestId: string | null;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  latencyMs: number;
}
export interface WebSearchResponse { providerRequestId: string | null; results: WebSearchResult[]; lineage?: WebSearchLineage; }
export interface WebSearchInput {
  query: string;
  limit: number;
  publicationWindow?: PublicationWindow;
  preferredDomains?: readonly string[];
  searchContext?: { channel: string; queryFamily: string; cities: readonly string[]; subtracks: readonly string[] };
}
export interface WebSearchProvider {
  readonly name: string;
  search(input: WebSearchInput): Promise<WebSearchResponse>;
}

class NonRetryableSearchError extends Error {}

const responseSchema = z.object({
  requestId: z.string().max(500).optional(),
  results: z.array(z.object({ id: z.string().max(4_000), title: z.string().max(1_000), url: z.string().max(4_000), publishedDate: z.string().nullable().optional(), highlights: z.array(z.string().max(20_000)).max(20).optional() })).max(100),
});

const deepSeekSearchResponseSchema = z.object({
  id: z.string().max(500),
  model: z.string().max(500).optional(),
  status: z.string().optional(),
  usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional(), total_tokens: z.number().optional() }).optional(),
  output: z.array(z.object({
    type: z.string(),
    content: z.array(z.object({
      type: z.string(),
      text: z.string().max(1_000_000).optional(),
    }).passthrough()).max(100).optional(),
  }).passthrough()).max(100),
});

const deepSeekSearchOutputSchema = z.object({
  results: z.array(z.object({
    title: z.string().trim().min(1).max(1_000),
    url: z.string().trim().max(4_000),
    publishedAt: z.string().nullable().optional(),
    highlights: z.array(z.string().trim().min(1).max(20_000)).max(20),
  })).max(20),
});

export class DeepSeekWebSearchProvider implements WebSearchProvider {
  readonly name = "deepseek-web-search";

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly model = "deepseek-v4-flash",
    private readonly prompt: ResolvedPrompt<{ query: string; limit: number }> = createBuiltinPromptRegistry().resolve(PROMPT_REFS.webSearch),
  ) {}

  async search(input: WebSearchInput): Promise<WebSearchResponse> {
    const query = input.query.trim();
    if (!this.apiKey.trim()) throw new Error("DeepSeek API key is required.");
    if (query.length < 2 || query.length > 500) throw new Error("Search query must contain 2 to 500 characters.");
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 20) throw new Error("Search limit must be between 1 and 20.");

    const renderedPrompt = this.prompt.render({ query, limit: input.limit });
    const body = JSON.stringify({
      model: this.model,
      instructions: renderedPrompt.system,
      input: renderedPrompt.user + publicationWindowInstruction(input)
        + (input.preferredDomains?.length ? `\n优先检索以下已配置域名：${input.preferredDomains.join(", ")}；优先具体原文，不要频道首页或无事实依据的聚合页。` : "")
        + (input.searchContext ? `\n发现渠道：${input.searchContext.channel}；Query Family：${input.searchContext.queryFamily}；重点城市：${input.searchContext.cities.join("、") || "全国"}；子赛道：${input.searchContext.subtracks.join("、") || "不限"}。` : ""),
      tools: [{ type: "web_search" }],
      tool_choice: { type: "web_search" },
      max_output_tokens: renderedPrompt.maxTokens ?? 4_000,
      text: {
        format: {
          type: "json_schema",
          name: "web_search_results",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["results"],
            properties: {
              results: {
                type: "array",
                maxItems: input.limit,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["title", "url", "publishedAt", "highlights"],
                  properties: {
                    title: { type: "string" },
                    url: { type: "string" },
                    publishedAt: { anyOf: [{ type: "string" }, { type: "null" }] },
                    highlights: { type: "array", items: { type: "string" }, maxItems: 20 },
                  },
                },
              },
            },
          },
        },
      },
    });
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.searchOnce(body, input.limit);
      } catch (error) {
        if (error instanceof NonRetryableSearchError) throw error;
        lastError = error;
      }
    }
    throw lastError;
  }

  private async searchOnce(body: string, limit: number): Promise<WebSearchResponse> {
    const startedAt = performance.now();
    const response = await this.fetchImpl("https://api.deepseek.com/responses", {
      method: "POST", redirect: "error",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body,
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status >= 400 && response.status < 500) throw new NonRetryableSearchError("DeepSeek web search request was rejected.");
      throw new Error("DeepSeek web search request failed.");
    }
    if (response.headers.get("content-type")?.split(";", 1)[0] !== "application/json") { await response.body?.cancel(); throw new Error("DeepSeek web search returned an invalid content type."); }

    const text = await readLimitedResponseText(response, 2_097_152, "DeepSeek web search response exceeded the byte limit.");
    const parsedResponse = deepSeekSearchResponseSchema.parse(JSON.parse(text));
    if (parsedResponse.status && parsedResponse.status !== "completed") throw new Error("DeepSeek web search did not complete.");
    const outputText = parsedResponse.output
      .filter((item) => item.type === "message")
      .flatMap((item) => item.content ?? [])
      .filter((part) => part.type === "output_text" && part.text)
      .map((part) => part.text)
      .join("");
    if (!outputText) throw new Error("DeepSeek web search returned no structured output.");
    const output = parseDeepSeekSearchOutput(outputText, limit);
    const uniqueResults = new Map<string, WebSearchResult>();
    for (const result of output.results.slice(0, limit)) {
      const normalized = normalizeDeepSeekResult(result);
      uniqueResults.set(normalized.url, normalized);
    }
    return {
      providerRequestId: parsedResponse.id,
      results: Array.from(uniqueResults.values()),
      lineage: {
        provider: this.name,
        prompt: { id: this.prompt.id, version: this.prompt.version, hash: this.prompt.hash },
        requestedModel: this.model,
        actualModel: parsedResponse.model ?? this.model,
        providerRequestId: parsedResponse.id,
        usage: {
          ...(parsedResponse.usage?.input_tokens === undefined ? {} : { inputTokens: parsedResponse.usage.input_tokens }),
          ...(parsedResponse.usage?.output_tokens === undefined ? {} : { outputTokens: parsedResponse.usage.output_tokens }),
          ...(parsedResponse.usage?.total_tokens === undefined ? {} : { totalTokens: parsedResponse.usage.total_tokens }),
        },
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      },
    };
  }
}

function publicationWindowInstruction(input: WebSearchInput): string {
  if (!input.publicationWindow) return "";
  const range = `日期范围[${input.publicationWindow.start}, ${input.publicationWindow.end})`;
  if (input.searchContext?.channel && input.searchContext.channel !== "venture_tech") return `\n${range}。优先返回窗口内新增或发生变化的公开页面；非新闻型官网、工商、招聘和榜单页面没有发布日期时，publishedAt返回null，禁止猜测。`;
  const date = new Date(Date.parse(input.publicationWindow.start) + 8 * 3_600_000).toISOString().slice(0, 10);
  return `\n只查北京时间（Asia/Shanghai）${date}当天首次发布的投资/融资新闻。${range}。publishedAt必须取原文首次发布时间，禁止用更新、抓取、收录或事件发生日期代替；无法核实返回null，不得猜成今天。没有符合条件的新闻返回空数组，不要用旧闻补足数量。`;
}

function parseDeepSeekSearchOutput(outputText: string, limit: number): z.infer<typeof deepSeekSearchOutputSchema> {
  try {
    return deepSeekSearchOutputSchema.parse(JSON.parse(outputText));
  } catch (jsonError) {
    const results: Array<{ title: string; url: string; publishedAt: null; highlights: string[] }> = [];
    const linkPattern = /\[([^\]\r\n]{1,1000})\]\((https:\/\/[^)\s]{1,4000})\)/gu;
    for (const match of outputText.matchAll(linkPattern)) {
      if (results.length >= limit) break;
      const lineStart = outputText.lastIndexOf("\n", match.index ?? 0) + 1;
      const nextLineBreak = outputText.indexOf("\n", (match.index ?? 0) + match[0].length);
      const lineEnd = nextLineBreak === -1 ? outputText.length : nextLineBreak;
      const highlight = outputText.slice(lineStart, lineEnd).replace(match[0], match[1]).trim().slice(0, 20_000);
      results.push({ title: match[1].trim(), url: match[2], publishedAt: null, highlights: highlight ? [highlight] : [match[1].trim()] });
    }
    if (results.length === 0) throw jsonError;
    return deepSeekSearchOutputSchema.parse({ results });
  }
}

export class ExaSearchProvider implements WebSearchProvider {
  readonly name = "exa";
  constructor(private readonly apiKey: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async search(input: WebSearchInput): Promise<WebSearchResponse> {
    const startedAt = performance.now();
    const query = input.query.trim();
    if (!this.apiKey.trim()) throw new Error("Exa API key is required.");
    if (query.length < 2 || query.length > 500) throw new Error("Search query must contain 2 to 500 characters.");
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50) throw new Error("Search limit must be between 1 and 50.");
    const body = JSON.stringify({ query, type: "fast", numResults: input.limit, moderation: true, ...(input.publicationWindow ? { startPublishedDate: input.publicationWindow.start, endPublishedDate: input.publicationWindow.end } : {}), ...(input.preferredDomains?.length ? { includeDomains: input.preferredDomains } : {}), contents: { highlights: true }, systemPrompt: `Prefer original and official sources. Return URLs as discovery leads only.${input.searchContext ? ` Channel: ${input.searchContext.channel}. Query family: ${input.searchContext.queryFamily}. Cities: ${input.searchContext.cities.join(",") || "nationwide"}. Subtracks: ${input.searchContext.subtracks.join(",") || "all"}.` : ""}` });
    const response = await this.fetchImpl("https://api.exa.ai/search", { method: "POST", redirect: "error", headers: { "content-type": "application/json", "x-api-key": this.apiKey }, body, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) { await response.body?.cancel(); throw new Error("Exa search request failed."); }
    if (response.headers.get("content-type")?.split(";", 1)[0] !== "application/json") { await response.body?.cancel(); throw new Error("Exa search returned an invalid content type."); }
    const text = await readLimitedResponseText(response, 2_097_152, "Exa search response exceeded the byte limit.");
    const parsed = responseSchema.parse(JSON.parse(text));
    return {
      providerRequestId: parsed.requestId ?? null,
      results: parsed.results.map((result) => normalizeResult(result)),
      lineage: { provider: this.name, providerRequestId: parsed.requestId ?? null, latencyMs: Math.max(0, Math.round(performance.now() - startedAt)) },
    };
  }
}

function normalizeResult(result: z.infer<typeof responseSchema>["results"][number]): WebSearchResult {
  const url = new URL(result.url);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Search results must use credential-free HTTPS URLs.");
  const publishedAt = normalizeNewsPublishedAt(result.publishedDate);
  return { externalId: result.id, title: result.title.trim(), url: url.toString(), publishedAt, highlights: (result.highlights ?? []).map((value) => value.trim()).filter(Boolean) };
}

function normalizeDeepSeekResult(result: z.infer<typeof deepSeekSearchOutputSchema>["results"][number]): WebSearchResult {
  const url = new URL(result.url);
  if (url.protocol !== "https:" || url.username || url.password) throw new NonRetryableSearchError("Search results must use credential-free HTTPS URLs.");
  const publishedAt = normalizeNewsPublishedAt(result.publishedAt);
  return {
    externalId: `deepseek-${createHash("sha256").update(url.toString()).digest("hex")}`,
    title: result.title,
    url: url.toString(),
    publishedAt,
    highlights: result.highlights,
  };
}
