import type { ModelGateway, ModelCallLineage } from "@/connectors/model-gateway";
import { PROMPT_REFS } from "@/prompts/catalog";
import type { PromptRef } from "@/prompts/contract";
import type { PromptRegistry } from "@/prompts/registry";
import { discoveryInputSchema, discoveryOutputSchema, researchBriefInputSchema, researchBriefSchema, validateDiscoveryAssessments, validateResearchBrief, type DiscoveryLeadAssessment, type DiscoveryLeadInput, type ResearchBrief, type ResearchBriefInput } from "./contracts";

export interface AnalysisLineage extends ModelCallLineage { prompt: PromptRef & { hash: string }; }
export interface AnalysisResult<T> { data: T; lineage: AnalysisLineage; }
export interface AnalysisPromptBindings { leadQualification: PromptRef; researchBrief: PromptRef; }

export class StructuredAnalysisGateway {
  constructor(private readonly model: ModelGateway, private readonly prompts: PromptRegistry, private readonly bindings: AnalysisPromptBindings = PROMPT_REFS) {}

  async generateResearchBrief(input: ResearchBriefInput): Promise<ResearchBrief> { return (await this.generateResearchBriefWithLineage(input)).data; }
  async generateResearchBriefWithLineage(rawInput: ResearchBriefInput): Promise<AnalysisResult<ResearchBrief>> {
    const input = researchBriefInputSchema.parse(rawInput);
    const prompt = this.prompts.resolve<ResearchBriefInput>(this.bindings.researchBrief);
    const result = await this.model.generateStructured(prompt.render(input), researchBriefSchema);
    validateResearchBrief(input, result.data);
    return { data: result.data, lineage: { ...result.lineage, prompt: { id: prompt.id, version: prompt.version, hash: prompt.hash } } };
  }

  async qualifyDiscoveryLeads(input: { query: string; leads: DiscoveryLeadInput[] }): Promise<DiscoveryLeadAssessment[]> { return (await this.qualifyDiscoveryLeadsWithLineage(input)).data; }
  async qualifyDiscoveryLeadsWithLineage(rawInput: { query: string; leads: DiscoveryLeadInput[] }): Promise<AnalysisResult<DiscoveryLeadAssessment[]>> {
    const input = discoveryInputSchema.parse(rawInput);
    const prompt = this.prompts.resolve<typeof input>(this.bindings.leadQualification);
    const result = await this.model.generateStructured(prompt.render(input), discoveryOutputSchema);
    validateDiscoveryAssessments(input.leads, result.data.assessments);
    return { data: result.data.assessments, lineage: { ...result.lineage, prompt: { id: prompt.id, version: prompt.version, hash: prompt.hash } } };
  }
}
