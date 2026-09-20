import { z } from "zod";
import { PROMPT_REFS } from "@/prompts/catalog";

const componentRefSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,99}$/),
  version: z.string().trim().regex(/^\d+\.\d+\.\d+$/),
}).strict();

const promptModuleSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,99}$/),
  version: z.string().trim().regex(/^\d+\.\d+\.\d+$/),
  system: z.string().trim().min(1).max(20_000),
  userTemplate: z.string().trim().min(1).max(20_000),
  maxTokens: z.number().int().min(1).max(16_000).optional(),
  temperature: z.number().min(0).max(2).optional(),
}).strict().superRefine((value, context) => {
  const placeholders = Array.from(value.userTemplate.matchAll(/{{([^{}]+)}}/g), (match) => match[1]);
  if (placeholders.some((name) => name !== "inputJson")) {
    context.addIssue({ code: "custom", message: "Only {{inputJson}} is allowed in prompt modules.", path: ["userTemplate"] });
  }
});

const runtimeConfigSchema = z.object({
  $comment: z.string().max(2_000).optional(),
  schemaVersion: z.literal(1).default(1),
  defaults: z.object({
    searchProvider: z.enum(["deepseek-web-search", "exa"]).default("deepseek-web-search"),
    discoveryWorkflow: componentRefSchema.default({ id: "project-discovery", version: "1.0.0" }),
    researchWorkflow: componentRefSchema.default({ id: "project-research", version: "1.0.0" }),
    prompts: z.object({
      webSearch: componentRefSchema.default(PROMPT_REFS.webSearch),
      leadQualification: componentRefSchema.default(PROMPT_REFS.leadQualification),
      researchBrief: componentRefSchema.default(PROMPT_REFS.researchBrief),
    }).strict().default(PROMPT_REFS),
  }).strict().default({
    searchProvider: "deepseek-web-search",
    discoveryWorkflow: { id: "project-discovery", version: "1.0.0" },
    researchWorkflow: { id: "project-research", version: "1.0.0" },
    prompts: PROMPT_REFS,
  }),
  promptModules: z.array(promptModuleSchema).max(100).default([]),
}).strict();

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;
export type RuntimePromptModuleConfig = z.infer<typeof promptModuleSchema>;

export function parseRuntimeConfig(input: unknown): RuntimeConfig {
  return runtimeConfigSchema.parse(input);
}
