import { archiveDueApprovals } from "@/workbench/approval-lifecycle";
import { archiveUnassignedCandidates } from "@/workbench/candidate-queue";
import { authenticationRequired } from "@/security/identity-scope";
import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { DiscoveryLeadAssessment, DiscoveryLeadInput, ResearchBrief, ResearchBriefInput } from "@/analysis/contracts";
import type { AnalysisResult } from "@/analysis/structured-analysis-gateway";
import { SearchProviderRegistry } from "@/connectors/search-registry";
import type { WebSearchProvider } from "@/connectors/web-search";
import { SqliteBackgroundAgentRepository, type AgentSearchPlan, type ClaimedResearchJob } from "@/repositories/background-agent";
import { SqliteWorkflowRecorder } from "@/repositories/workflow-runs";
import { createProjectDiscoveryWorkflow } from "@/workflows/project-discovery";
import { createProjectResearchWorkflow } from "@/workflows/project-research";
import { WorkflowRegistry } from "@/workflows/registry";
import { WorkflowRunner } from "@/workflows/runner";
import { createAgentSkillRegistry } from "@/skills/agent-skills";
import type { SkillRegistry } from "@/skills/registry";
import { SqliteWebSearchRepository } from "@/repositories/web-search";
import { discoverWebLeads } from "@/services/web-search";
import { analyzeNextDocument } from "@/workbench/documents";
import { IntelligenceDiscoveryRepository } from "@/intelligence/repository";
import { runDueIntelligencePlan } from "@/intelligence/plan-runner";
import { publishWeekdayIntelligenceDigest } from "@/intelligence/digest";

const componentRefSchema = z.object({ id: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,99}$/), version: z.string().regex(/^\d+\.\d+\.\d+$/) }).strict();
const manifestSchema = z.object({
  $comment: z.string().max(2_000).optional(),
  searchPlans: z.array(z.object({
    id: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,99}$/), name: z.string().trim().min(2).max(200), query: z.string().trim().min(2).max(500),
    intervalMinutes: z.number().int().min(5).max(10_080), limit: z.number().int().min(1).max(20), enabled: z.boolean(),
    workflow: componentRefSchema.default({ id: "project-discovery", version: "1.0.0" }),
    searchProvider: z.object({ id: z.enum(["deepseek-web-search", "exa"]), version: z.literal("1.0.0") }).strict().default({ id: "deepseek-web-search", version: "1.0.0" }),
  }).strict()).max(200),
}).strict();

export type AgentManifest = z.input<typeof manifestSchema>;

export interface ResearchGateway {
  generateResearchBrief(input: ResearchBriefInput): Promise<ResearchBrief>;
  qualifyDiscoveryLeads(input: { query: string; leads: DiscoveryLeadInput[] }): Promise<DiscoveryLeadAssessment[]>;
  generateResearchBriefWithLineage?(input: ResearchBriefInput): Promise<AnalysisResult<ResearchBrief>>;
  qualifyDiscoveryLeadsWithLineage?(input: { query: string; leads: DiscoveryLeadInput[] }): Promise<AnalysisResult<DiscoveryLeadAssessment[]>>;
}

export interface PersonalJobRuntime { workflows: WorkflowRegistry; searchProvider: WebSearchProvider; researchGateway: ResearchGateway; }
export type PersonalRuntimeResolver = (type: "research" | "discovery", jobId: string) => Promise<PersonalJobRuntime> | PersonalJobRuntime;

export interface AgentCycleResult { searchRuns: number; discoveryRuns: number; intelligenceRuns: number; researchRuns: number; documentRuns: number; digestPublished: boolean; failures: number; }

export function syncAgentManifest(
  database: DatabaseSync,
  rawManifest: AgentManifest,
  now = new Date().toISOString(),
  defaults: { discoveryWorkflow: { id: string; version: string }; searchProvider: "deepseek-web-search" | "exa" } = {
    discoveryWorkflow: { id: "project-discovery", version: "1.0.0" },
    searchProvider: "deepseek-web-search",
  },
): void {
  const manifest = manifestSchema.parse({
    ...rawManifest,
    searchPlans: rawManifest.searchPlans.map((plan) => ({
      ...plan,
      workflow: plan.workflow ?? defaults.discoveryWorkflow,
      searchProvider: plan.searchProvider ?? { id: defaults.searchProvider, version: "1.0.0" },
    })),
  });
  new SqliteBackgroundAgentRepository(database).syncSearchPlans(manifest.searchPlans, now);
}

export async function runBackgroundAgentCycle(input: {
  repository: SqliteBackgroundAgentRepository;
  searchProvider: WebSearchProvider;
  searchProviders?: SearchProviderRegistry;
  researchGateway: ResearchGateway;
  workflows?: WorkflowRegistry;
  workerId: string;
  resolvePersonalRuntime?: PersonalRuntimeResolver;
  now?: string;
  documentAnalyzer?: (text: string, context: { projectId: string; documentId: string }) => Promise<{ summary?: string; risks?: string[] }>;
}): Promise<AgentCycleResult> {
  const now = input.now ?? new Date().toISOString();
  archiveDueApprovals(input.repository.database, new Date(now));
  archiveUnassignedCandidates(input.repository.database, new Date(now));
  const providers = input.searchProviders ?? createCompatibilitySearchRegistry(input.searchProvider);
  const workflows = input.workflows ?? createBuiltinWorkflowRegistry(input.repository, providers, input.researchGateway);
  new IntelligenceDiscoveryRepository(input.repository.database).listPlans(now);
  const intelligenceResult = await runDueIntelligencePlan({ database: input.repository.database, provider: input.searchProvider, workerId: input.workerId, now });
  const searchResult = await executeDueSearch(input.repository, workflows, input.workerId, now);
  const discoveryResult = await executeOnDemandDiscovery(input.repository, input.searchProvider, input.researchGateway, input.workerId, now, input.resolvePersonalRuntime);
  const researchResult = await executeQueuedResearch(input.repository, workflows, input.workerId, now, input.resolvePersonalRuntime);
  let documentResult = { ran: false, failed: false };
  try { documentResult = { ...(await analyzeNextDocument(input.repository.database, { workerId: input.workerId, now, externalAnalyze: input.documentAnalyzer })), failed: false }; }
  catch { documentResult = { ran: true, failed: true }; }
  let digestPublished = false;
  let digestFailed = false;
  try { digestPublished = publishWeekdayIntelligenceDigest(input.repository.database, now).published; } catch { digestFailed = true; }
  return {
    searchRuns: searchResult.ran ? 1 : 0,
    discoveryRuns: discoveryResult.ran ? 1 : 0,
    intelligenceRuns: intelligenceResult.ran ? 1 : 0,
    researchRuns: researchResult.ran ? 1 : 0,
    documentRuns: documentResult.ran ? 1 : 0,
    digestPublished,
    failures: Number(intelligenceResult.failed) + Number(searchResult.failed) + Number(discoveryResult.failed) + Number(researchResult.failed) + Number(documentResult.failed) + Number(digestFailed),
  };
}

export function createBuiltinWorkflowRegistry(repository: SqliteBackgroundAgentRepository, searchProviders: SearchProviderRegistry, researchGateway: ResearchGateway, skillRegistry: SkillRegistry = createAgentSkillRegistry(researchGateway)): WorkflowRegistry {
  return new WorkflowRegistry()
    .register(createProjectDiscoveryWorkflow({ repository, searchProviders, skills: skillRegistry }))
    .register(createProjectDiscoveryWorkflow({ repository, searchProviders, skills: skillRegistry }, "1.1.0"))
    .register(createProjectResearchWorkflow({ repository, skills: skillRegistry }))
    .register(createProjectResearchWorkflow({ repository, skills: skillRegistry }, "1.1.0"));
}

async function executeDueSearch(repository: SqliteBackgroundAgentRepository, workflows: WorkflowRegistry, workerId: string, now: string): Promise<{ ran: boolean; failed: boolean }> {
  const plan = repository.claimDueSearchPlan(workerId, now);
  if (!plan) return { ran: false, failed: false };
  const traceId = randomUUID();
  try {
    const definition = workflows.resolve<{ plan: AgentSearchPlan; now: string; traceId: string; workerId: string }, object, { receipt: object; candidateCount: number }, { traceId: string; now: string }>(plan.workflow);
    const runner = new WorkflowRunner(new SqliteWorkflowRecorder(repository.database, "scheduled_search", plan.id));
    await runner.run(definition, { plan, now, traceId, workerId }, { traceId, now });
    return { ran: true, failed: false };
  } catch {
    repository.failSearchPlan(plan, now, workerId, traceId);
    return { ran: true, failed: true };
  }
}

async function executeQueuedResearch(repository: SqliteBackgroundAgentRepository, workflows: WorkflowRegistry, workerId: string, now: string, resolvePersonal?: PersonalRuntimeResolver): Promise<{ ran: boolean; failed: boolean }> {
  const job = repository.claimResearchJob(workerId, now);
  if (!job) return { ran: false, failed: false };
  let selectedWorkflows = workflows;
  if (resolvePersonal || authenticationRequired()) {
    try {
      if (!resolvePersonal) throw new Error("PERSONAL_AI_REQUIRED");
      selectedWorkflows = (await resolvePersonal("research", job.id)).workflows;
    } catch {
      repository.failResearchJob({ ...job, attemptCount: job.maxAttempts }, now, workerId, "PERSONAL_AI_REQUIRED");
      return { ran: true, failed: true };
    }
  }
  try {
    const definition = selectedWorkflows.resolve<{ job: ClaimedResearchJob; now: string; workerId: string }, object, { brief: ResearchBrief; lineage?: AnalysisResult<ResearchBrief>["lineage"] }, { traceId: string; now: string }>(job.workflow);
    const runner = new WorkflowRunner(new SqliteWorkflowRecorder(repository.database, "research_job", job.id));
    await runner.run(definition, { job, now, workerId }, { traceId: job.id, now });
    return { ran: true, failed: false };
  } catch {
    repository.failResearchJob(job, now, workerId);
    return { ran: true, failed: true };
  }
}

async function executeOnDemandDiscovery(repository: SqliteBackgroundAgentRepository, provider: WebSearchProvider, gateway: ResearchGateway, workerId: string, now: string, resolvePersonal?: PersonalRuntimeResolver): Promise<{ ran: boolean; failed: boolean }> {
  const database = repository.database;
  database.exec("BEGIN IMMEDIATE");
  let job: { id: string; query_json: string; attempt_count: number; max_attempts: number } | undefined;
  try {
    job = database.prepare(`SELECT id,query_json,attempt_count,max_attempts FROM discovery_jobs
      WHERE status='queued' AND attempt_count<max_attempts AND (next_attempt_at IS NULL OR next_attempt_at<=?)
      ORDER BY created_at,id LIMIT 1`).get(now) as typeof job;
    if (!job) { database.exec("COMMIT"); return { ran: false, failed: false }; }
    database.prepare(`UPDATE discovery_jobs SET status='running',attempt_count=attempt_count+1,started_at=coalesce(started_at,?),lease_owner=?,lease_until=?,error_code=NULL WHERE id=?`)
      .run(now, workerId, new Date(Date.parse(now) + 300_000).toISOString(), job.id);
    database.exec("COMMIT");
  } catch (error) { database.exec("ROLLBACK"); throw error; }

  const queryInput = JSON.parse(job.query_json) as { query: string; resultLimit: number; channel?: "venture_tech" | "registry" | "hiring" | "ranking_award"; queryFamily?: string; cities?: string[]; subtracks?: string[]; dateWindowDays?: number; preferredDomains?: string[] };
  const workflowRunId = randomUUID();
  const traceId = randomUUID();
  database.prepare(`INSERT INTO workflow_runs (id,workflow_id,workflow_version,trigger_type,trigger_ref,status,trace_id,input_hash,started_at)
    VALUES (?,'project-discovery','1.1.0','on_demand_discovery',?,'running',?,?,?)`)
    .run(workflowRunId, job.id, traceId, createHash("sha256").update(job.query_json).digest("hex"), now);
  let selectedProvider = provider;
  let selectedGateway = gateway;
  if (resolvePersonal || authenticationRequired()) {
    try {
      if (!resolvePersonal) throw new Error("PERSONAL_AI_REQUIRED");
      const personal = await resolvePersonal("discovery", job.id);
      selectedProvider = personal.searchProvider; selectedGateway = personal.researchGateway;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error && error.code === "SEARCH_SERVICE_REQUIRED" ? "SEARCH_SERVICE_REQUIRED" : "PERSONAL_AI_REQUIRED";
      database.prepare("UPDATE discovery_jobs SET status='failed',finished_at=?,lease_owner=NULL,lease_until=NULL,error_code=? WHERE id=?").run(now, code, job.id);
      database.prepare("UPDATE workflow_runs SET status='failed',error_code=?,finished_at=? WHERE id=?").run(code, now, workflowRunId);
      return { ran: true, failed: true };
    }
  }
  try {
    database.prepare("UPDATE discovery_jobs SET provider_id=? WHERE id=? AND lease_owner=?").run(selectedProvider.name, job.id, workerId);
    const webRepository = new SqliteWebSearchRepository(database);
    const receipt = await discoverWebLeads(webRepository, selectedProvider, { query: queryInput.query, limit: queryInput.resultLimit, traceId, observedAt: now, channel: queryInput.channel, queryFamily: queryInput.queryFamily, cities: queryInput.cities, subtracks: queryInput.subtracks, dateWindowDays: queryInput.dateWindowDays, preferredDomains: queryInput.preferredDomains });
    database.prepare("UPDATE discovery_jobs SET provider_id=? WHERE id=? AND lease_owner=?").run(receipt.lineage?.provider ?? selectedProvider.name, job.id, workerId);
    const leads = webRepository.listRunLeads(receipt.runId);
    const assessments = leads.length > 0 ? await selectedGateway.qualifyDiscoveryLeads({ query: queryInput.query, leads }) : [];
    repository.persistQualifiedCandidates(assessments.filter(assessment => leads.some(lead => lead.id === assessment.leadId)), now, traceId);
    database.prepare("UPDATE discovery_jobs SET status='succeeded',finished_at=?,lease_owner=NULL,lease_until=NULL,error_code=NULL WHERE id=? AND lease_owner=?").run(now, job.id, workerId);
    database.prepare("UPDATE workflow_runs SET status='succeeded',finished_at=? WHERE id=?").run(now, workflowRunId);
    return { ran: true, failed: false };
  } catch {
    const attempt = job.attempt_count + 1;
    const terminal = attempt >= job.max_attempts;
    const next = terminal ? null : new Date(Date.parse(now) + Math.min(60, 5 * (2 ** (attempt - 1))) * 60_000).toISOString();
    database.prepare("UPDATE discovery_jobs SET status=?,finished_at=?,next_attempt_at=?,lease_owner=NULL,lease_until=NULL,error_code='DISCOVERY_FAILED' WHERE id=?").run(terminal ? "failed" : "queued", terminal ? now : null, next, job.id);
    database.prepare("UPDATE workflow_runs SET status='failed',error_code='DISCOVERY_FAILED',finished_at=? WHERE id=?").run(now, workflowRunId);
    return { ran: true, failed: true };
  }
}

function createCompatibilitySearchRegistry(provider: WebSearchProvider): SearchProviderRegistry {
  const registry = new SearchProviderRegistry().register({ id: "deepseek-web-search", version: "1.0.0" }, provider);
  if (provider.name !== "deepseek-web-search") registry.register({ id: provider.name, version: "1.0.0" }, provider);
  return registry;
}
