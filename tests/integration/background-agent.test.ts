import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import { SqliteBackgroundAgentRepository } from "@/repositories/background-agent";
import { listAgentSearchPlans, listProjectCandidates } from "@/repositories/dashboard-data";
import { SqliteProjectRepository } from "@/repositories/projects";
import { SqliteResearchJobRepository } from "@/repositories/research-jobs";
import { createResearchJob } from "@/services/research-jobs";
import { readDiscoverySchedule, updateDiscoverySchedule } from "@/services/discovery-schedule";
import { runBackgroundAgentCycle, syncAgentManifest } from "@/services/background-agent";

vi.mock("@/connectors/news-publication-verifier", () => ({ verifyNewsPublication: vi.fn(async () => "2026-08-31T00:00:00.000Z") }));

describe("background agent", () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = createDatabase(":memory:");
    initializeDatabase(database);
    seedDemoData(database);
  });

  it("claims a due search plan, persists leads, records a timeline event, and reschedules", async () => {
    const now = "2026-08-31T02:00:00.000Z";
    syncAgentManifest(database, {
      searchPlans: [{
        id: "daily-semi",
        name: "头部机构半导体投资",
        query: "中国 头部投资机构 半导体 投资 融资",
        intervalMinutes: 1_440,
        limit: 10,
        enabled: true,
      }],
    }, now);
    enableScheduledSearch(database, now);
    const search = vi.fn().mockResolvedValue({
      providerRequestId: "exa-request-1",
      results: [{
        externalId: "result-1",
        title: "某机构宣布投资硬科技项目",
        url: "https://example.com/investment/1",
        publishedAt: "2026-08-31T00:00:00.000Z",
        highlights: ["该机构宣布完成对一家半导体企业的投资。"],
      }],
    });
    const qualifyDiscoveryLeads = vi.fn().mockResolvedValue([{ 
      leadId: "web-lead-0d88f6d2766fbd22ebce854fee27236f43252bff6eb9cc4fa99afd31a71ddf51",
      relevant: true,
      companyName: "某半导体企业",
      track: "半导体",
      investorNames: ["某机构"],
      signalType: "funding",
      summary: "某机构宣布投资一家半导体企业。",
      confidence: 0.86,
    }]);

    const result = await runBackgroundAgentCycle({
      repository: new SqliteBackgroundAgentRepository(database),
      searchProvider: { name: "exa", search },
      researchGateway: { generateResearchBrief: vi.fn(), qualifyDiscoveryLeads },
      workerId: "worker-1",
      now,
    });

    expect(result).toMatchObject({ searchRuns: 1, researchRuns: 0, failures: 0 });
    expect(search).toHaveBeenCalledWith({ query: "中国 头部投资机构 半导体 投资 融资", limit: 10, preferredDomains: ["chinaventure.com.cn", "36kr.com"], publicationWindow: { start: "2026-08-30T16:00:00.000Z", end: "2026-08-31T16:00:00.000Z" } });
    expect(database.prepare("SELECT status,inserted_count FROM web_search_runs").get()).toMatchObject({ status: "succeeded", inserted_count: 1 });
    expect(database.prepare("SELECT status FROM web_search_leads WHERE url=?").get("https://example.com/investment/1")).toMatchObject({ status: "discovered" });
    expect(qualifyDiscoveryLeads).toHaveBeenCalledOnce();
    expect(database.prepare("SELECT company_name,track,status,prompt_version FROM project_candidates").get()).toMatchObject({ company_name: "某半导体企业", track: "半导体", status: "pending_review", prompt_version: "lead-qualification-v1" });
    expect(listProjectCandidates(database, 100, new Date(now))).toEqual([expect.objectContaining({ companyName: "某半导体企业", investorNames: ["某机构"], track: "半导体" })]);
    expect(listAgentSearchPlans(database)).toEqual([expect.objectContaining({ id: "daily-semi", lastStatus: "succeeded", consecutiveFailures: 0 })]);
    expect(database.prepare("SELECT event_type,subject_type FROM platform_timeline WHERE event_type='search.completed'").get()).toMatchObject({ event_type: "search.completed", subject_type: "search_plan" });
    expect(database.prepare("SELECT event_type,subject_type FROM platform_timeline WHERE event_type='lead.qualified'").get()).toMatchObject({ event_type: "lead.qualified", subject_type: "project_candidate" });
    expect(database.prepare("SELECT next_run_at,lease_owner,consecutive_failures FROM agent_search_plans WHERE id='daily-semi'").get()).toMatchObject({ next_run_at: "2026-08-31T06:00:00.000Z", lease_owner: null, consecutive_failures: 0 });
    expect(database.prepare("SELECT workflow_id,workflow_version,status,trigger_type FROM workflow_runs").get()).toMatchObject({ workflow_id: "project-discovery", workflow_version: "1.0.0", status: "succeeded", trigger_type: "scheduled_search" });
    expect(database.prepare("SELECT count(*) AS count FROM workflow_step_runs").get()).toMatchObject({ count: 4 });
    expect(database.prepare("SELECT step_id,provider_id FROM workflow_step_runs WHERE step_id='search-web'").get()).toMatchObject({ step_id: "search-web", provider_id: "exa" });

    database.prepare("UPDATE project_candidates SET status='promoted' WHERE lead_id=?").run("web-lead-0d88f6d2766fbd22ebce854fee27236f43252bff6eb9cc4fa99afd31a71ddf51");
    new SqliteBackgroundAgentRepository(database).persistQualifiedCandidates([{ ...contentAssessment(), summary: "模型后续改写" }], "2026-09-01T02:01:00.000Z", "repeat-trace");
    expect(database.prepare("SELECT status,summary FROM project_candidates").get()).toMatchObject({ status: "promoted", summary: "某机构宣布投资一家半导体企业。" });
  });

  it("claims a queued research job and persists the DeepSeek report and project timeline", async () => {
    const job = createResearchJob(new SqliteResearchJobRepository(database), {
      tenantId: "demo",
      projectId: "project-qiongxin",
      idempotencyKey: "agent-research-1",
    });
    const generateResearchBrief = vi.fn().mockResolvedValue({
      summary: "项目已披露融资并进入客户送测阶段。",
      findings: [{ claim: "已披露融资", evidenceIds: ["evidence-project-qiongxin"] }],
      risks: ["客户名称尚未披露"],
      openQuestions: ["客户验证进度如何？"],
    });

    const result = await runBackgroundAgentCycle({
      repository: new SqliteBackgroundAgentRepository(database),
      searchProvider: { name: "exa", search: vi.fn() },
      researchGateway: { generateResearchBrief, qualifyDiscoveryLeads: vi.fn() },
      workerId: "worker-1",
      now: "2026-08-31T03:00:00.000Z",
    });

    expect(result).toMatchObject({ searchRuns: 0, researchRuns: 1, failures: 0 });
    expect(generateResearchBrief).toHaveBeenCalledOnce();
    expect(database.prepare("SELECT status,attempt_count,finished_at FROM research_jobs WHERE id=?").get(job.id)).toMatchObject({ status: "succeeded", attempt_count: 1, finished_at: "2026-08-31T03:00:00.000Z" });
    expect(database.prepare("SELECT model,summary,status FROM research_reports WHERE research_job_id=?").get(job.id)).toMatchObject({ model: "deepseek", summary: "项目已披露融资并进入客户送测阶段。", status: "draft" });
    expect(database.prepare("SELECT event_type,project_id FROM platform_timeline WHERE event_type='research.completed' AND project_id='project-qiongxin'").get()).toMatchObject({ event_type: "research.completed", project_id: "project-qiongxin" });
    expect(database.prepare("SELECT last_researched_at,status FROM projects WHERE id='project-qiongxin'").get()).toMatchObject({ last_researched_at: "2026-08-31T03:00:00.000Z", status: "researching" });
    const project = new SqliteProjectRepository(database).findById("project-qiongxin")!;
    expect(project.researchReports).toEqual([expect.objectContaining({ summary: "项目已披露融资并进入客户送测阶段。", status: "draft" })]);
    expect(project.agentTimeline).toEqual(expect.arrayContaining([expect.objectContaining({ type: "research.completed", summary: "DeepSeek 研究草稿已生成，等待人工复核" })]));
    expect(database.prepare("SELECT workflow_id,workflow_version,status,trigger_type FROM workflow_runs").get()).toMatchObject({ workflow_id: "project-research", workflow_version: "1.0.0", status: "succeeded", trigger_type: "research_job" });
    expect(database.prepare("SELECT count(*) AS count FROM workflow_step_runs").get()).toMatchObject({ count: 3 });
  });

  it("passes the selected profile, skills, and instructions into research 1.1", async () => {
    createResearchJob(new SqliteResearchJobRepository(database), {
      tenantId: "demo",
      projectId: "project-qiongxin",
      idempotencyKey: "profiled-research",
      workflow: { id: "project-research", version: "1.1.0" },
      profileId: "technology-moat",
      profileVersion: "1.0.0",
      skillRefs: ["analyze-technology@1.0.0", "analyze-risk@1.0.0"],
      requestedBy: "user-demo",
      instructions: "重点核验量产良率。",
    });
    const generateResearchBrief = vi.fn().mockResolvedValue({
      summary: "研究完成。",
      findings: [{ claim: "已送测", evidenceIds: ["evidence-project-qiongxin"] }],
      risks: [],
      openQuestions: [],
    });

    await runBackgroundAgentCycle({
      repository: new SqliteBackgroundAgentRepository(database),
      searchProvider: { name: "exa", search: vi.fn() },
      researchGateway: { generateResearchBrief, qualifyDiscoveryLeads: vi.fn() },
      workerId: "worker-profile",
      now: "2026-09-02T04:00:00.000Z",
    });

    expect(generateResearchBrief).toHaveBeenCalledWith(expect.objectContaining({
      profile: expect.objectContaining({ id: "technology-moat", version: "1.0.0" }),
      skillRefs: ["analyze-technology@1.0.0", "analyze-risk@1.0.0"],
      instructions: "重点核验量产良率。",
    }));
  });

  it("releases failed searches until the next fixed slot and records a sanitized failure", async () => {
    const now = "2026-08-31T06:00:00.000Z";
    syncAgentManifest(database, {
      searchPlans: [{ id: "daily-ai", name: "AI 投资", query: "中国 AI 投资 融资", intervalMinutes: 60, limit: 5, enabled: true }],
    }, now);
    enableScheduledSearch(database, now);

    const result = await runBackgroundAgentCycle({
      repository: new SqliteBackgroundAgentRepository(database),
      searchProvider: { name: "exa", search: vi.fn().mockRejectedValue(new Error("secret upstream response")) },
      researchGateway: { generateResearchBrief: vi.fn(), qualifyDiscoveryLeads: vi.fn() },
      workerId: "worker-1",
      now,
    });

    expect(result).toMatchObject({ searchRuns: 1, failures: 1 });
    expect(database.prepare("SELECT next_run_at,lease_owner,consecutive_failures,last_error_code FROM agent_search_plans WHERE id='daily-ai'").get()).toMatchObject({ next_run_at: "2026-09-01T02:00:00.000Z", lease_owner: null, consecutive_failures: 1, last_error_code: "SEARCH_FAILED" });
    const timeline = database.prepare("SELECT event_type,summary,metadata_json FROM platform_timeline WHERE event_type='search.failed'").get() as { event_type: string; summary: string; metadata_json: string };
    expect(timeline.event_type).toBe("search.failed");
    expect(`${timeline.summary}${timeline.metadata_json}`).not.toContain("secret upstream response");
  });

  it("completes an empty search without invoking the model and ignores disabled plans", async () => {
    const now = "2026-08-31T02:00:00.000Z";
    syncAgentManifest(database, { searchPlans: [
      { id: "enabled-empty", name: "空结果计划", query: "中国 核聚变 投资", intervalMinutes: 60, limit: 5, enabled: true },
      { id: "disabled-plan", name: "停用计划", query: "中国 AI 投资", intervalMinutes: 60, limit: 5, enabled: false },
    ] }, now);
    enableScheduledSearch(database, now);
    const qualifyDiscoveryLeads = vi.fn();

    const result = await runBackgroundAgentCycle({
      repository: new SqliteBackgroundAgentRepository(database),
      searchProvider: { name: "exa", search: vi.fn().mockResolvedValue({ providerRequestId: null, results: [] }) },
      researchGateway: { generateResearchBrief: vi.fn(), qualifyDiscoveryLeads },
      workerId: "worker-empty",
      now,
    });

    expect(result).toEqual({ searchRuns: 1, discoveryRuns: 0, intelligenceRuns: 0, researchRuns: 0, documentRuns: 0, digestPublished: true, failures: 0 });
    expect(qualifyDiscoveryLeads).not.toHaveBeenCalled();
    expect(database.prepare("SELECT last_status FROM agent_search_plans WHERE id='enabled-empty'").get()).toMatchObject({ last_status: "succeeded" });
    expect(database.prepare("SELECT last_status,lease_owner FROM agent_search_plans WHERE id='disabled-plan'").get()).toMatchObject({ last_status: null, lease_owner: null });
  });

  it("retries failed research with backoff and stops at the attempt limit", async () => {
    const repository = new SqliteBackgroundAgentRepository(database);
    const job = createResearchJob(new SqliteResearchJobRepository(database), {
      tenantId: "demo",
      projectId: "project-qiongxin",
      idempotencyKey: "failing-research",
    });
    const researchGateway = { generateResearchBrief: vi.fn().mockRejectedValue(new Error("private model response")), qualifyDiscoveryLeads: vi.fn() };

    const first = await runBackgroundAgentCycle({ repository, searchProvider: { name: "exa", search: vi.fn() }, researchGateway, workerId: "worker-retry", now: "2026-08-31T06:00:00.000Z" });
    const tooEarly = await runBackgroundAgentCycle({ repository, searchProvider: { name: "exa", search: vi.fn() }, researchGateway, workerId: "worker-retry", now: "2026-08-31T06:04:59.000Z" });
    const second = await runBackgroundAgentCycle({ repository, searchProvider: { name: "exa", search: vi.fn() }, researchGateway, workerId: "worker-retry", now: "2026-08-31T06:05:00.000Z" });
    const third = await runBackgroundAgentCycle({ repository, searchProvider: { name: "exa", search: vi.fn() }, researchGateway, workerId: "worker-retry", now: "2026-08-31T06:15:00.000Z" });

    expect(first).toMatchObject({ researchRuns: 1, failures: 1 });
    expect(tooEarly).toMatchObject({ researchRuns: 0, failures: 0 });
    expect(second).toMatchObject({ researchRuns: 1, failures: 1 });
    expect(third).toMatchObject({ researchRuns: 1, failures: 1 });
    expect(database.prepare("SELECT status,attempt_count,finished_at,error_code FROM research_jobs WHERE id=?").get(job.id)).toMatchObject({ status: "failed", attempt_count: 3, finished_at: "2026-08-31T06:15:00.000Z", error_code: "MODEL_FAILED" });
    const timeline = database.prepare("SELECT summary,metadata_json FROM platform_timeline WHERE event_type='research.failed' ORDER BY created_at DESC LIMIT 1").get() as { summary: string; metadata_json: string };
    expect(timeline.summary).toContain("重试上限");
    expect(timeline.metadata_json).not.toContain("private model response");
  });

  it("does not overwrite an investment manager decision and recovers an expired terminal lease", async () => {
    database.prepare("UPDATE projects SET status='contacting' WHERE id='project-qiongxin'").run();
    const repository = new SqliteBackgroundAgentRepository(database);
    const successful = createResearchJob(new SqliteResearchJobRepository(database), { tenantId: "demo", projectId: "project-qiongxin", idempotencyKey: "preserve-status" });
    const gateway = { generateResearchBrief: vi.fn().mockResolvedValue({ summary: "研究完成", findings: [{ claim: "已送测", evidenceIds: ["evidence-project-qiongxin"] }], risks: [], openQuestions: [] }), qualifyDiscoveryLeads: vi.fn() };
    await runBackgroundAgentCycle({ repository, searchProvider: { name: "exa", search: vi.fn() }, researchGateway: gateway, workerId: "worker-safe", now: "2026-08-31T08:00:00.000Z" });
    expect(database.prepare("SELECT status FROM projects WHERE id='project-qiongxin'").get()).toMatchObject({ status: "contacting" });
    expect(database.prepare("SELECT status FROM research_jobs WHERE id=?").get(successful.id)).toMatchObject({ status: "succeeded" });

    const crashed = createResearchJob(new SqliteResearchJobRepository(database), { tenantId: "demo", projectId: "project-qiongxin", idempotencyKey: "crashed-terminal" });
    database.prepare(`UPDATE research_jobs SET status='running',attempt_count=max_attempts,lease_owner='dead-worker',lease_until=? WHERE id=?`).run("2026-08-31T08:00:00.000Z", crashed.id);
    const result = await runBackgroundAgentCycle({ repository, searchProvider: { name: "exa", search: vi.fn() }, researchGateway: gateway, workerId: "worker-recovery", now: "2026-08-31T08:01:00.000Z" });
    expect(result.researchRuns).toBe(0);
    expect(database.prepare("SELECT status,error_code,lease_owner FROM research_jobs WHERE id=?").get(crashed.id)).toMatchObject({ status: "failed", error_code: "WORKER_TIMEOUT", lease_owner: null });
  });

  it("rejects unsafe or overly frequent search manifests", () => {
    expect(() => syncAgentManifest(database, { searchPlans: [{ id: "Bad ID", name: "x", query: "x", intervalMinutes: 1, limit: 100, enabled: true }] }, "2026-08-31T07:00:00.000Z")).toThrow();
    expect(() => syncAgentManifest(database, { searchPlans: [{ id: "valid-id", name: "有效计划", query: "中国 投资", intervalMinutes: 60, limit: 21, enabled: true }] }, "2026-08-31T07:00:00.000Z")).toThrow();
  });

  it("keeps old manifests compatible and stores pinned module references", () => {
    syncAgentManifest(database, { searchPlans: [{ id: "compatible", name: "兼容计划", query: "中国 投资", intervalMinutes: 60, limit: 5, enabled: true }] }, "2026-09-01T00:00:00.000Z");
    expect(database.prepare("SELECT workflow_id,workflow_version,search_provider_id,search_provider_version FROM agent_search_plans WHERE id='compatible'").get()).toMatchObject({
      workflow_id: "project-discovery", workflow_version: "1.0.0", search_provider_id: "deepseek-web-search", search_provider_version: "1.0.0",
    });
  });

  it("uses runtime defaults when a plan omits workflow and provider refs", () => {
    syncAgentManifest(database, { searchPlans: [{ id: "runtime-default", name: "运行默认", query: "中国 投资", intervalMinutes: 60, limit: 5, enabled: true }] }, "2026-09-01T00:00:00.000Z", {
      discoveryWorkflow: { id: "project-discovery", version: "2.0.0" }, searchProvider: "exa",
    });
    expect(database.prepare("SELECT workflow_id,workflow_version,search_provider_id FROM agent_search_plans WHERE id='runtime-default'").get()).toMatchObject({
      workflow_id: "project-discovery", workflow_version: "2.0.0", search_provider_id: "exa",
    });
  });
});

function contentAssessment() {
  return { leadId: "web-lead-0d88f6d2766fbd22ebce854fee27236f43252bff6eb9cc4fa99afd31a71ddf51", relevant: true, companyName: "某半导体企业", track: "半导体" as const, investorNames: ["某机构"], signalType: "funding" as const, summary: "某机构宣布投资一家半导体企业。", confidence: 0.86 };
}

function enableScheduledSearch(database: DatabaseSync, at: string) {
  updateDiscoverySchedule(database, { enabled: true, version: readDiscoverySchedule(database).version }, "test-admin", new Date(Date.parse(at) - 1).toISOString());
}
