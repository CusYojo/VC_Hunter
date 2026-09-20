import { isPublishedInWindow, normalizeNewsPublishedAt, publicationWindowForDay } from "@/domain/news-publication";
import { randomUUID } from "node:crypto";
import { ensureDiscoverySchedule, nextDiscoveryRun } from "@/services/discovery-schedule";
import type { DatabaseSync } from "node:sqlite";
import type { DiscoveryLeadAssessment, ResearchBrief } from "@/analysis/contracts";
import type { AnalysisLineage } from "@/analysis/structured-analysis-gateway";

const LEGACY_LEAD_PROMPT_VERSION = "lead-qualification-v1";

export interface AgentSearchPlan {
  id: string;
  name: string;
  query: string;
  intervalMinutes: number;
  limit: number;
  consecutiveFailures: number;
  workflow: { id: string; version: string };
  searchProvider: { id: string; version: string };
}

export interface ClaimedResearchJob {
  id: string;
  projectId: string;
  attemptCount: number;
  maxAttempts: number;
  workflow: { id: string; version: string };
  profileId?: string | null;
  profileVersion?: string | null;
  skillRefs: readonly string[];
  requestedBy?: string | null;
  instructions?: string;
}

export interface AgentManifestPlan {
  id: string;
  name: string;
  query: string;
  intervalMinutes: number;
  limit: number;
  enabled: boolean;
  workflow: { id: string; version: string };
  searchProvider: { id: string; version: string };
}

interface SearchPlanRow {
  id: string;
  name: string;
  query: string;
  interval_minutes: number;
  result_limit: number;
  consecutive_failures: number;
  workflow_id: string;
  workflow_version: string;
  search_provider_id: string;
  search_provider_version: string;
}

interface ResearchJobRow {
  id: string;
  project_id: string;
  attempt_count: number;
  max_attempts: number;
  workflow_id: string;
  workflow_version: string;
  profile_id: string | null;
  profile_version: string | null;
  skill_refs_json: string;
  requested_by: string | null;
  instructions: string;
}

export class SqliteBackgroundAgentRepository {
  constructor(readonly database: DatabaseSync) {}

  syncSearchPlans(plans: readonly AgentManifestPlan[], now: string): void {
    ensureDiscoverySchedule(this.database, now);
    const statement = this.database.prepare(`INSERT INTO agent_search_plans
      (id,name,query,interval_minutes,result_limit,enabled,next_run_at,created_at,updated_at,workflow_id,workflow_version,search_provider_id,search_provider_version)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,query=excluded.query,
        interval_minutes=excluded.interval_minutes,result_limit=excluded.result_limit,
        enabled=excluded.enabled,updated_at=excluded.updated_at,workflow_id=excluded.workflow_id,
        workflow_version=excluded.workflow_version,search_provider_id=excluded.search_provider_id,
        search_provider_version=excluded.search_provider_version`);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("UPDATE agent_search_plans SET enabled=0,lease_owner=NULL,lease_until=NULL,updated_at=?").run(now);
      for (const plan of plans) statement.run(plan.id, plan.name, plan.query, plan.intervalMinutes, plan.limit, plan.enabled ? 1 : 0, nextDiscoveryRun(now), now, now, plan.workflow.id, plan.workflow.version, plan.searchProvider.id, plan.searchProvider.version);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  claimDueSearchPlan(workerId: string, now: string, leaseSeconds = 300): AgentSearchPlan | undefined {
    ensureDiscoverySchedule(this.database, now);
    const leaseUntil = addSeconds(now, leaseSeconds);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.database.prepare(`SELECT id,name,query,interval_minutes,result_limit,consecutive_failures,workflow_id,workflow_version,search_provider_id,search_provider_version
        FROM agent_search_plans WHERE enabled=1 AND next_run_at<=?
        AND EXISTS(SELECT 1 FROM discovery_schedule_settings WHERE id='organization' AND enabled=1)
        AND (lease_until IS NULL OR lease_until<=?) ORDER BY next_run_at,id LIMIT 1`).get(now, now) as unknown as SearchPlanRow | undefined;
      if (!row) { this.database.exec("COMMIT"); return undefined; }
      const result = this.database.prepare(`UPDATE agent_search_plans SET lease_owner=?,lease_until=?,last_started_at=?,updated_at=?,next_run_at=?
        WHERE id=? AND (lease_until IS NULL OR lease_until<=?)`).run(workerId, leaseUntil, now, now, nextDiscoveryRun(now), row.id, now);
      if (result.changes !== 1) { this.database.exec("COMMIT"); return undefined; }
      this.database.exec("COMMIT");
      return mapSearchPlan(row);
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  completeSearchPlan(plan: AgentSearchPlan, now: string, workerId: string, receipt: unknown, traceId: string): void {
    const nextRunAt = nextDiscoveryRun(now);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      assertLeaseChange(this.database.prepare(`UPDATE agent_search_plans SET next_run_at=?,lease_owner=NULL,lease_until=NULL,
        last_finished_at=?,last_status='succeeded',consecutive_failures=0,last_error_code=NULL,updated_at=? WHERE id=? AND lease_owner=?`)
        .run(nextRunAt, now, now, plan.id, workerId));
      this.insertTimeline("search.completed", "search_plan", plan.id, null, "background-agent", `${plan.name} 搜索完成`, receipt, traceId, now);
      this.database.exec("COMMIT");
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  failSearchPlan(plan: AgentSearchPlan, now: string, workerId: string, traceId: string): void {
    const failureCount = plan.consecutiveFailures + 1;
    const nextRunAt = nextDiscoveryRun(now);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      assertLeaseChange(this.database.prepare(`UPDATE agent_search_plans SET next_run_at=?,lease_owner=NULL,lease_until=NULL,
        last_finished_at=?,last_status='failed',consecutive_failures=?,last_error_code='SEARCH_FAILED',updated_at=? WHERE id=? AND lease_owner=?`)
        .run(nextRunAt, now, failureCount, now, plan.id, workerId));
      this.insertTimeline("search.failed", "search_plan", plan.id, null, "background-agent", `${plan.name} 搜索失败，等待下个定时时点`, { errorCode: "SEARCH_FAILED", nextRunAt }, traceId, now);
      this.database.exec("COMMIT");
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  persistQualifiedCandidates(assessments: readonly DiscoveryLeadAssessment[], now: string, traceId: string, lineage?: AnalysisLineage): number {
    const window = publicationWindowForDay(now);
    const relevant = assessments.filter((item) => {
      if (!item.relevant || !item.companyName || !item.track) return false;
      const lead = this.database.prepare("SELECT published_at,publication_verified_at FROM web_search_leads WHERE id=?").get(item.leadId);
      if (typeof lead?.publication_verified_at !== "string" || !normalizeNewsPublishedAt(lead.publication_verified_at) || Date.parse(lead.publication_verified_at) > Date.parse(now)) return false;
      const publishedAt = typeof lead?.published_at === "string" ? normalizeNewsPublishedAt(lead.published_at) : null;
      return isPublishedInWindow(publishedAt, window) && publishedAt !== null && Date.parse(publishedAt) <= Date.parse(now);
    });
    const model = lineage?.actualModel ?? "deepseek";
    const promptVersion = lineage?.prompt.version ?? LEGACY_LEAD_PROMPT_VERSION;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const assessment of relevant) {
        const id = `candidate-${assessment.leadId}`;
        this.database.prepare(`INSERT INTO project_candidates
          (id,lead_id,company_name,track,investor_names_json,signal_type,summary,confidence,status,model,prompt_version,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,'pending_review',?,?,?,?)
          ON CONFLICT(lead_id) DO UPDATE SET company_name=excluded.company_name,track=excluded.track,
            investor_names_json=excluded.investor_names_json,signal_type=excluded.signal_type,summary=excluded.summary,
            confidence=excluded.confidence,model=excluded.model,prompt_version=excluded.prompt_version,updated_at=excluded.updated_at
          WHERE project_candidates.status='pending_review'
            AND NOT EXISTS (SELECT 1 FROM candidate_details cd WHERE cd.candidate_id=project_candidates.id AND cd.origin='manual_screenshot')`)
          .run(id, assessment.leadId, assessment.companyName, assessment.track, JSON.stringify(assessment.investorNames), assessment.signalType, assessment.summary, assessment.confidence, model, promptVersion, now, now);
        const alreadyRecorded = this.database.prepare("SELECT 1 FROM platform_timeline WHERE event_type='lead.qualified' AND subject_id=?").get(id);
        if (!alreadyRecorded) this.insertTimeline("lead.qualified", "project_candidate", id, null, "background-agent", `${assessment.companyName} 已进入项目候选复核`, { leadId: assessment.leadId, track: assessment.track, confidence: assessment.confidence, promptVersion }, traceId, now);
      }
      this.database.exec("COMMIT");
      return relevant.length;
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  claimResearchJob(workerId: string, now: string, leaseSeconds = 600): ClaimedResearchJob | undefined {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const expiredTerminal = this.database.prepare(`SELECT id,project_id,project_status_before FROM research_jobs
        WHERE status='running' AND lease_until<=? AND attempt_count>=max_attempts`).all(now) as unknown as Array<{ id: string; project_id: string; project_status_before: string | null }>;
      this.database.prepare(`UPDATE research_jobs SET status='failed',finished_at=?,lease_owner=NULL,lease_until=NULL,error_code='WORKER_TIMEOUT'
        WHERE status='running' AND lease_until<=? AND attempt_count>=max_attempts`).run(now, now);
      for (const expired of expiredTerminal) {
        if (expired.project_status_before) this.database.prepare("UPDATE projects SET status=?,version=version+1 WHERE id=? AND status='researching'").run(expired.project_status_before, expired.project_id);
        this.insertTimeline("research.failed", "research_job", expired.id, expired.project_id, "background-agent", "研究 Worker 租约超时，任务已终止", { errorCode: "WORKER_TIMEOUT" }, expired.id, now);
      }
      this.database.prepare(`UPDATE research_jobs SET status='queued',next_attempt_at=?,lease_owner=NULL,lease_until=NULL,error_code='WORKER_TIMEOUT'
        WHERE status='running' AND lease_until<=? AND attempt_count<max_attempts`).run(now, now);
      const row = this.database.prepare(`SELECT id,project_id,attempt_count,max_attempts,workflow_id,workflow_version,
        profile_id,profile_version,skill_refs_json,requested_by,instructions FROM research_jobs
        WHERE attempt_count<max_attempts AND (next_attempt_at IS NULL OR next_attempt_at<=?)
        AND status='queued' ORDER BY created_at,id LIMIT 1`).get(now) as unknown as ResearchJobRow | undefined;
      if (!row) { this.database.exec("COMMIT"); return undefined; }
      const project = this.database.prepare("SELECT status FROM projects WHERE id=?").get(row.project_id) as { status: string } | undefined;
      if (!project) throw new Error("Project not found.");
      const result = this.database.prepare(`UPDATE research_jobs SET status='running',started_at=coalesce(started_at,?),
        attempt_count=attempt_count+1,lease_owner=?,lease_until=?,error_code=NULL,
        project_status_before=coalesce(project_status_before,?) WHERE id=?`).run(now, workerId, addSeconds(now, leaseSeconds), project.status, row.id);
      if (result.changes !== 1) { this.database.exec("COMMIT"); return undefined; }
      this.database.prepare("UPDATE projects SET status='researching',version=version+1 WHERE id=? AND status='new'").run(row.project_id);
      this.insertTimeline("research.started", "research_job", row.id, row.project_id, "background-agent", "研究任务开始执行", { attempt: row.attempt_count + 1 }, row.id, now);
      this.database.exec("COMMIT");
      return {
        id: row.id,
        projectId: row.project_id,
        attemptCount: row.attempt_count + 1,
        maxAttempts: row.max_attempts,
        workflow: { id: row.workflow_id, version: row.workflow_version },
        profileId: row.profile_id,
        profileVersion: row.profile_version,
        skillRefs: JSON.parse(row.skill_refs_json ?? "[]") as string[],
        requestedBy: row.requested_by,
        instructions: row.instructions ?? "",
      };
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  completeResearchJob(job: ClaimedResearchJob, brief: ResearchBrief, now: string, workerId: string, lineage?: AnalysisLineage): void {
    const model = lineage?.actualModel ?? "deepseek";
    const providerLabel = lineage?.provider === "deepseek" || !lineage ? "DeepSeek" : "模型";
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`INSERT INTO research_reports
        (id,research_job_id,project_id,model,status,summary,findings_json,risks_json,open_questions_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), job.id, job.projectId, model, "draft", brief.summary, JSON.stringify(brief.findings), JSON.stringify(brief.risks), JSON.stringify(brief.openQuestions), now, now);
      assertLeaseChange(this.database.prepare(`UPDATE research_jobs SET status='succeeded',finished_at=?,lease_owner=NULL,lease_until=NULL,
        next_attempt_at=NULL,error_code=NULL WHERE id=? AND lease_owner=?`).run(now, job.id, workerId));
      this.database.prepare("UPDATE projects SET last_researched_at=?,version=version+1 WHERE id=?").run(now, job.projectId);
      this.insertTimeline("research.completed", "research_job", job.id, job.projectId, "background-agent", `${providerLabel} 研究草稿已生成，等待人工复核`, { reportStatus: "draft", findingCount: brief.findings.length, promptVersion: lineage?.prompt.version ?? null }, job.id, now);
      this.database.exec("COMMIT");
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  failResearchJob(job: ClaimedResearchJob, now: string, workerId: string, errorCode = "MODEL_FAILED"): void {
    const terminal = job.attemptCount >= job.maxAttempts;
    const nextAttemptAt = terminal ? null : addMinutes(now, Math.min(60, 5 * (2 ** (job.attemptCount - 1))));
    this.database.exec("BEGIN IMMEDIATE");
    try {
      assertLeaseChange(this.database.prepare(`UPDATE research_jobs SET status=?,finished_at=?,next_attempt_at=?,lease_owner=NULL,
        lease_until=NULL,error_code=? WHERE id=? AND lease_owner=?`).run(terminal ? "failed" : "queued", terminal ? now : null, nextAttemptAt, errorCode, job.id, workerId));
      if (terminal) {
        const row = this.database.prepare("SELECT project_status_before FROM research_jobs WHERE id=?").get(job.id) as { project_status_before: string | null };
        if (row.project_status_before) this.database.prepare("UPDATE projects SET status=?,version=version+1 WHERE id=? AND status='researching'").run(row.project_status_before, job.projectId);
      }
      this.insertTimeline("research.failed", "research_job", job.id, job.projectId, "background-agent", terminal ? "研究任务失败，已达到重试上限" : "研究任务失败，等待重试", { errorCode, attempt: job.attemptCount }, job.id, now);
      this.database.exec("COMMIT");
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  private insertTimeline(eventType: string, subjectType: string, subjectId: string, projectId: string | null, actor: string, summary: string, metadata: unknown, traceId: string, now: string): void {
    this.database.prepare(`INSERT INTO platform_timeline
      (id,event_type,subject_type,subject_id,project_id,actor,summary,metadata_json,trace_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), eventType, subjectType, subjectId, projectId, actor, summary, JSON.stringify(metadata), traceId, now);
  }
}

function mapSearchPlan(row: SearchPlanRow): AgentSearchPlan {
  return {
    id: row.id, name: row.name, query: row.query, intervalMinutes: row.interval_minutes, limit: row.result_limit, consecutiveFailures: row.consecutive_failures,
    workflow: { id: row.workflow_id, version: row.workflow_version },
    searchProvider: { id: row.search_provider_id, version: row.search_provider_version },
  };
}

function addMinutes(timestamp: string, minutes: number): string { return new Date(Date.parse(timestamp) + minutes * 60_000).toISOString(); }
function addSeconds(timestamp: string, seconds: number): string { return new Date(Date.parse(timestamp) + seconds * 1_000).toISOString(); }
function assertLeaseChange(result: { changes: number | bigint }): void { if (Number(result.changes) !== 1) throw new Error("Background agent lease was lost."); }
