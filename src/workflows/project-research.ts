import { z } from "zod";
import type { AnalysisLineage } from "@/analysis/structured-analysis-gateway";
import type { ResearchBrief, ResearchBriefInput } from "@/analysis/contracts";
import { PROMPT_REFS } from "@/prompts/catalog";
import { AGENT_SKILL_REFS } from "@/skills/agent-skills";
import type { SkillRegistry } from "@/skills/registry";
import type { ClaimedResearchJob, SqliteBackgroundAgentRepository } from "@/repositories/background-agent";
import { SqliteProjectRepository } from "@/repositories/projects";
import type { WorkflowDefinition } from "./contract";
import { analysisProfileRegistry } from "@/workbench/analysis-profiles";

const jobSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  attemptCount: z.number(),
  maxAttempts: z.number(),
  workflow: z.object({ id: z.string(), version: z.string() }).strict(),
  profileId: z.string().nullable().optional(),
  profileVersion: z.string().nullable().optional(),
  skillRefs: z.array(z.string()).default([]),
  requestedBy: z.string().nullable().optional(),
  instructions: z.string().optional(),
}).strict();
const inputSchema = z.object({ job: jobSchema, now: z.string(), workerId: z.string() }).strict();
const outputSchema = z.object({ brief: z.object({ summary: z.string(), findings: z.array(z.object({ claim: z.string(), evidenceIds: z.array(z.string()) })), risks: z.array(z.string()), openQuestions: z.array(z.string()) }), lineage: z.custom<AnalysisLineage>().optional() }).strict();

interface ResearchState {
  job: ClaimedResearchJob;
  now: string;
  workerId: string;
  researchInput?: ResearchBriefInput;
  brief?: ResearchBrief;
  analysisLineage?: AnalysisLineage;
}

export function createProjectResearchWorkflow(dependencies: { repository: SqliteBackgroundAgentRepository; skills: SkillRegistry }, version = "1.0.0"): WorkflowDefinition<z.infer<typeof inputSchema>, ResearchState, { brief: ResearchBrief; lineage?: AnalysisLineage }> {
  return {
    id: "project-research", version, inputSchema, outputSchema,
    createState: (input) => input,
    steps: [
      {
        id: "assemble-evidence", version: "1.0.0",
        run: async (_context, state) => {
          const project = new SqliteProjectRepository(dependencies.repository.database).findById(state.job.projectId);
          if (!project) throw new Error("Project not found.");
          const evidence = uniqueEvidence(project.assertions.flatMap((assertion) => assertion.evidence).filter((item) => item.modelShareable));
          if (evidence.length === 0) throw new Error("Research requires evidence.");
          const baseInput: ResearchBriefInput = { projectName: project.name, track: project.track, evidence };
          if (version === "1.0.0" || !state.job.profileId) return { ...state, researchInput: baseInput };
          const profile = analysisProfileRegistry.resolve(state.job.profileId, state.job.skillRefs);
          if (state.job.profileVersion && state.job.profileVersion !== profile.version) throw new Error("Research profile version is not registered.");
          return {
            ...state,
            researchInput: {
              ...baseInput,
              profile: { id: profile.id, version: profile.version, label: profile.label, description: profile.description },
              skillRefs: [...profile.skillRefs],
              ...(state.job.instructions?.trim() ? { instructions: state.job.instructions.trim() } : {}),
            },
          };
        },
      },
      {
        id: "generate-brief", version: "1.0.0",
        lineage: { skill: AGENT_SKILL_REFS.generateResearchBrief, prompt: PROMPT_REFS.researchBrief },
        lineageFromState: (state) => analysisStepLineage(state.analysisLineage),
        run: async (_context, state) => {
          if (!state.researchInput) throw new Error("Research evidence is missing.");
          const skill = dependencies.skills.resolve<ResearchBriefInput, ResearchBrief>(AGENT_SKILL_REFS.generateResearchBrief.id, AGENT_SKILL_REFS.generateResearchBrief.version);
          if (!skill?.executeWithLineage) throw new Error("Research brief skill is not registered.");
          const result = await skill.executeWithLineage({ runId: state.job.id, provider: "runtime", modelVersion: "runtime" }, state.researchInput);
          return { ...state, brief: result.data, ...(result.lineage ? { analysisLineage: result.lineage } : {}) };
        },
      },
      {
        id: "persist-report", version: "1.0.0",
        run: async (_context, state) => {
          if (!state.brief) throw new Error("Research workflow did not produce a brief.");
          dependencies.repository.completeResearchJob(state.job, state.brief, state.now, state.workerId, state.analysisLineage);
          return state;
        },
      },
    ],
    output: (state) => {
      if (!state.brief) throw new Error("Research workflow did not produce a brief.");
      return { brief: state.brief, ...(state.analysisLineage ? { lineage: state.analysisLineage } : {}) };
    },
  };
}

function uniqueEvidence(evidence: Array<{ id: string; quote: string; authority: "A" | "B" | "C" | "D" }>): ResearchBriefInput["evidence"] {
  return Array.from(new Map(evidence.map((item) => [item.id, { id: item.id, quote: item.quote, authority: item.authority }])).values()).slice(0, 50);
}

function analysisStepLineage(lineage: AnalysisLineage | undefined) {
  if (!lineage) return {};
  return { prompt: lineage.prompt, provider: lineage.provider, requestedModel: lineage.requestedModel, model: lineage.actualModel, providerRequestId: lineage.providerRequestId, usage: lineage.usage, latencyMs: lineage.latencyMs };
}
