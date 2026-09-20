import type { AIProviderId } from "./settings-contracts";

/** Provider documentation checked 2026-09-04. Model access depends on the user's account. */
export const AI_PROVIDER_CATALOG_UPDATED_AT = "2026-09-04";
export const AI_PROVIDERS: readonly { id: AIProviderId; label: string; endpoint: string; models: readonly string[]; defaultModel: string; docsUrl: string }[] = [
  { id: "openai", label: "OpenAI", endpoint: "https://api.openai.com/v1/chat/completions", defaultModel: "gpt-5.6-sol", models: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6", "gpt-5.5", "gpt-5.4", "gpt-5-mini", "gpt-4.1", "gpt-4o-mini"], docsUrl: "https://developers.openai.com/api/docs/models/all" },
  { id: "claude", label: "Anthropic Claude", endpoint: "https://api.anthropic.com/v1/messages", defaultModel: "claude-sonnet-5", models: ["claude-fable-5-1", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001", "claude-sonnet-4-6"], docsUrl: "https://platform.claude.com/docs/en/models/overview" },
  { id: "kimi", label: "Moonshot Kimi", endpoint: "https://api.moonshot.cn/v1/chat/completions", defaultModel: "kimi-k3", models: ["kimi-k3", "kimi-k2.7-code", "kimi-k2.7-code-highspeed", "kimi-k2.6"], docsUrl: "https://platform.kimi.ai/docs/models" },
  { id: "deepseek", label: "DeepSeek", endpoint: "https://api.deepseek.com/chat/completions", defaultModel: "deepseek-v4-flash", models: ["deepseek-v4-flash", "deepseek-v4-pro"], docsUrl: "https://api-docs.deepseek.com/" },
  { id: "glm", label: "智谱 GLM", endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions", defaultModel: "glm-5.3", models: ["glm-5.3", "glm-5.3-flash", "glm-5.2", "glm-5.1", "glm-5"], docsUrl: "https://docs.bigmodel.cn/cn/guide/start/migrate-to-glm-new" },
  { id: "qwen", label: "阿里云 Qwen", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", defaultModel: "qwen3.7-plus", models: ["qwen3.8-max", "qwen3.8-max-0902", "qwen3.8-flash", "qwen3.7-plus", "qwen3.7-plus-2026-05-26", "qwen3.7-flash", "qwen3.7-flash-2026-07-15", "qwen-plus", "qwen-flash"], docsUrl: "https://help.aliyun.com/zh/model-studio/text-generation-model/" },
];
export function getAiProvider(id: AIProviderId) {
  const provider = AI_PROVIDERS.find((item) => item.id === id);
  if (!provider) throw new Error("Unsupported AI provider.");
  return provider;
}
