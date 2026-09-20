import { z } from "zod";
import type { AnalysisLineage } from "@/analysis/structured-analysis-gateway";
import type { DiscoveryLeadAssessment, DiscoveryLeadInput } from "@/analysis/contracts";
import type { SearchProviderRegistry } from "@/connectors/search-registry";
import { PROMPT_REFS } from "@/prompts/catalog";
import { AGENT_SKILL_REFS } from "@/skills/agent-skills";
import type { SkillRegistry } from "@/skills/registry";
import type { SqliteBackgroundAgentRepository, AgentSearchPlan } from "@/repositories/background-agent";
import { SqliteWebSearchRepository, type WebSearchReceipt } from "@/repositories/web-search";
import { discoverWebLeads } from "@/services/web-search";
import type { WorkflowDefinition } from "./contract";

const refSchema = z.object({ id: z.string(), version: z.string() }).strict();
const planSchema = z.object({
  id: z.string(), name: z.string(), query: z.string(), intervalMinutes: z.number(), limit: z.number(), consecutiveFailures: z.number(),
  workflow: refSchema, searchProvider: refSchema,
}).strict();
const inputSchema = z.object({ plan: planSchema, now: z.string(), traceId: z.string(), workerId: z.string() }).strict();
const outputSchema = z.object({ receipt: z.object({ runId: z.string(), resultCount: z.number(), insertedCount: z.number(), skippedCount: z.number() }), candidateCount: z.number() }).strict();

interface DiscoveryState {
  plan: AgentSearchPlan;
  now: string;
  traceId: string;
  workerId: string;
  receipt?: WebSearchReceipt;
  leads?: DiscoveryLeadInput[];
  assessments?: DiscoveryLeadAssessment[];
  candidateCount?: number;
  analysisLineage?: AnalysisLineage;
  searchProviderName?: string;
}

export function createProjectDiscoveryWorkflow(dependencies: {
  repository: SqliteBackgroundAgentRepository;
  searchProviders: SearchProviderRegistry;
  skills: SkillRegistry;
}, version = "1.0.0"): WorkflowDefinition<z.infer<typeof inputSchema>, DiscoveryState, z.infer<typeof outputSchema>> {
  return {
    id: "project-discovery",
    version,
    inputSchema,
    outputSchema,
    createState: (input) => input,
    steps: [
      {
        id: "search-web", version: "1.0.0",
        lineageFromState: (state) => state.receipt?.lineage ? ({
          provider: state.receipt.lineage.provider,
          prompt: state.receipt.lineage.prompt,
          requestedModel: state.receipt.lineage.requestedModel,
          model: state.receipt.lineage.actualModel,
          providerRequestId: state.receipt.lineage.providerRequestId,
          usage: state.receipt.lineage.usage,
          latencyMs: state.receipt.lineage.latencyMs,
        }) : ({ provider: state.searchProviderName ?? state.plan.searchProvider.id }),
        run: async (_context, state) => {
          const provider = dependencies.searchProviders.resolve(state.plan.searchProvider);
          const receipt = await discoverWebLeads(new SqliteWebSearchRepository(dependencies.repository.database), provider, { query: state.plan.query, limit: state.plan.limit, traceId: state.traceId, observedAt: state.now });
          return { ...state, receipt, searchProviderName: provider.name };
        },
      },
      {
        id: "qualify-leads", version: "1.0.0",
        lineage: { skill: AGENT_SKILL_REFS.qualifyDiscoveryLeads, prompt: PROMPT_REFS.leadQualification },
        lineageFromState: (state) => analysisStepLineage(state.analysisLineage),
        run: async (_context, state) => {
          if (!state.receipt) throw new Error("Discovery search receipt is missing.");
          const leads = new SqliteWebSearchRepository(dependencies.repository.database).listRunLeads(state.receipt.runId);
          if (leads.length === 0) return { ...state, leads, assessments: [] };
          const skill = dependencies.skills.resolve<{ query: string; leads: DiscoveryLeadInput[] }, DiscoveryLeadAssessment[]>(AGENT_SKILL_REFS.qualifyDiscoveryLeads.id, AGENT_SKILL_REFS.qualifyDiscoveryLeads.version);
          if (!skill?.executeWithLineage) throw new Error("Qualification skill is not registered.");
          const result = await skill.executeWithLineage({ runId: state.traceId, provider: "runtime", modelVersion: "runtime" }, { query: state.plan.query, leads });
          return { ...state, leads, assessments: result.data.filter(assessment => leads.some(lead => lead.id === assessment.leadId)), ...(result.lineage ? { analysisLineage: result.lineage } : {}) };
        },
      },
      {
        id: "persist-candidates", version: "1.0.0",
        run: async (_context, state) => ({ ...state, candidateCount: dependencies.repository.persistQualifiedCandidates(state.assessments ?? [], state.now, state.traceId, state.analysisLineage) }),
      },
      {
        id: "complete-search-plan", version: "1.0.0",
        run: async (_context, state) => {
          if (!state.receipt) throw new Error("Discovery search receipt is missing.");
          dependencies.repository.completeSearchPlan(state.plan, state.now, state.workerId, { ...state.receipt, candidateCount: state.candidateCount ?? 0 }, state.traceId);
          return state;
        },
      },
    ],
    output: (state) => {
      if (!state.receipt) throw new Error("Discovery workflow did not produce a receipt.");
      return { receipt: state.receipt, candidateCount: state.candidateCount ?? 0 };
    },
  };
}

function analysisStepLineage(lineage: AnalysisLineage | undefined) {
  if (!lineage) return {};
  return {
    prompt: lineage.prompt,
    provider: lineage.provider,
    model: lineage.actualModel,
    requestedModel: lineage.requestedModel,
    providerRequestId: lineage.providerRequestId,
    usage: lineage.usage,
    latencyMs: lineage.latencyMs,
  };
}
