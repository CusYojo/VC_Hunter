import { StructuredAnalysisGateway } from "@/analysis/structured-analysis-gateway";
import type { DiscoveryLeadAssessment, DiscoveryLeadInput, ResearchBrief, ResearchBriefInput } from "@/analysis/contracts";
import { createBuiltinPromptRegistry } from "@/prompts/catalog";
import { ModelGateway } from "./model-gateway";

export const LEAD_QUALIFICATION_PROMPT_VERSION = "lead-qualification-v1";
export type { DiscoveryLeadAssessment, DiscoveryLeadInput, ResearchBrief, ResearchBriefInput } from "@/analysis/contracts";

/** Backwards-compatible facade. New runtime code depends on StructuredAnalysisGateway. */
export class DeepSeekModelGateway {
  private readonly analysis: StructuredAnalysisGateway;

  constructor(apiKey: string, fetchImpl: typeof fetch = fetch, model = "deepseek-v4-flash") {
    this.analysis = new StructuredAnalysisGateway(
      new ModelGateway({ provider: "deepseek", apiKey, baseUrl: "https://api.deepseek.com/chat/completions", model, fetchImpl }),
      createBuiltinPromptRegistry(),
    );
  }

  generateResearchBrief(input: ResearchBriefInput): Promise<ResearchBrief> {
    return this.analysis.generateResearchBrief(input);
  }

  qualifyDiscoveryLeads(input: { query: string; leads: DiscoveryLeadInput[] }): Promise<DiscoveryLeadAssessment[]> {
    return this.analysis.qualifyDiscoveryLeads(input);
  }
}
