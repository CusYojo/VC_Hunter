import { z } from "zod";

export const AI_PROVIDER_IDS = ["openai", "claude", "kimi", "deepseek", "glm", "qwen"] as const;
export type AIProviderId = typeof AI_PROVIDER_IDS[number];
export interface AIProviderSettingsView {
  provider: AIProviderId;
  model: string;
  configured: boolean;
  updatedAt: string | null;
}
export interface AISettingsView {
  activeProvider: AIProviderId | null;
  providers: AIProviderSettingsView[];
}
export interface DecryptedAIConfiguration {
  provider: AIProviderId;
  model: string;
  apiKey: string;
}
export const aiProviderSettingsInputSchema = z.object({
  provider: z.enum(AI_PROVIDER_IDS),
  model: z.string().trim().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/),
  apiKey: z.string().trim().max(4096).refine((value) => !/[\x00-\x20\x7f]/.test(value)),
  activate: z.boolean().optional(),
}).strict().partial({ apiKey: true });
export type AIProviderSettingsInput = z.infer<typeof aiProviderSettingsInputSchema>;
export const deleteAIProviderSettingsSchema = z.object({ provider: z.enum(AI_PROVIDER_IDS) }).strict();
