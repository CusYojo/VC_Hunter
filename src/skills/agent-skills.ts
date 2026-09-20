import type { DiscoveryLeadAssessment, DiscoveryLeadInput, ResearchBrief, ResearchBriefInput } from "@/analysis/contracts";
import { discoveryAssessmentSchema, discoveryInputSchema, researchBriefInputSchema, researchBriefSchema } from "@/analysis/contracts";
import type { AnalysisResult } from "@/analysis/structured-analysis-gateway";
import { createBuiltinSkillRegistry } from "./executor";
import type { SkillModule } from "./registry";

export const AGENT_SKILL_REFS = Object.freeze({
  qualifyDiscoveryLeads: { id: "qualify-discovery-leads", version: "1.0.0" },
  generateResearchBrief: { id: "generate-research-brief", version: "1.0.0" },
} as const);

type QualificationInput = { query: string; leads: DiscoveryLeadInput[] };

export interface AgentAnalysisGateway {
  generateResearchBrief(input: ResearchBriefInput): Promise<ResearchBrief>;
  qualifyDiscoveryLeads(input: QualificationInput): Promise<DiscoveryLeadAssessment[]>;
  generateResearchBriefWithLineage?(input: ResearchBriefInput): Promise<AnalysisResult<ResearchBrief>>;
  qualifyDiscoveryLeadsWithLineage?(input: QualificationInput): Promise<AnalysisResult<DiscoveryLeadAssessment[]>>;
}

export function createAgentSkillRegistry(gateway: AgentAnalysisGateway) {
  return createBuiltinSkillRegistry()
    .register(createQualificationSkill(gateway))
    .register(createResearchBriefSkill(gateway));
}

function createQualificationSkill(gateway: AgentAnalysisGateway): SkillModule<QualificationInput, DiscoveryLeadAssessment[]> {
  return {
    definition: {
      ...AGENT_SKILL_REFS.qualifyDiscoveryLeads,
      promptVersion: "lead-qualification@1.0.0",
      description: "对搜索线索做结构化、可回指的硬科技投资相关性筛选。",
      requiresModel: true,
      inputSchema: discoveryInputSchema,
      outputSchema: discoveryAssessmentSchema.array().max(20),
      systemPrompt: "Resolved by PromptRegistry.",
    },
    execute: async (_context, input) => gateway.qualifyDiscoveryLeads(input),
    executeWithLineage: async (_context, input) => gateway.qualifyDiscoveryLeadsWithLineage
      ? gateway.qualifyDiscoveryLeadsWithLineage(input)
      : { data: await gateway.qualifyDiscoveryLeads(input) },
  };
}

function createResearchBriefSkill(gateway: AgentAnalysisGateway): SkillModule<ResearchBriefInput, ResearchBrief> {
  return {
    definition: {
      ...AGENT_SKILL_REFS.generateResearchBrief,
      promptVersion: "research-brief@1.0.0",
      description: "仅基于可发送证据生成结构化研究草稿并校验证据回指。",
      requiresModel: true,
      inputSchema: researchBriefInputSchema,
      outputSchema: researchBriefSchema,
      systemPrompt: "Resolved by PromptRegistry.",
    },
    execute: async (_context, input) => gateway.generateResearchBrief(input),
    executeWithLineage: async (_context, input): Promise<AnalysisResult<ResearchBrief> | { data: ResearchBrief }> => gateway.generateResearchBriefWithLineage
      ? gateway.generateResearchBriefWithLineage(input)
      : { data: await gateway.generateResearchBrief(input) },
  };
}
