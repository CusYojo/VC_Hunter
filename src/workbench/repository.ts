import { insertNotifications, notifyProjectCreated } from "./notifications";
import { archiveUnassignedCandidates } from "./candidate-queue";
import { filterCandidateQueue, type CandidateQueueFilters } from "./candidate-queue-contracts";
import { normalizeResponsibles, replaceProjectResponsibles } from "./project-responsibles";
import { personalSearchMode } from "@/ai/search-mode";
import { identityScope } from "@/security/identity-scope";
import { bindJobAIRequester } from "@/ai/job-requesters";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { TimelineEntry } from "./contracts";
import { TRACK_VALUES, type Track } from "@/domain/types";
import type { CandidateSource, CandidateView } from "./candidate-details";
import { loadTeamMembers, suggestOwner } from "./team";
import { candidateReviewSchema, discoveryJobInputSchema, judgmentInputSchema, knowledgeReviewSchema } from "./contracts";

type CandidateReviewInput = { decision: "promote" | "reject"; expectedVersion: number; reason?: string; track?: Track; assignee?: string; assignees?: string[] };
type JudgmentInput = { expectedVersion: number; thesis: string; stance: "positive" | "neutral" | "cautious" | "negative"; occurredAt: string };

export class SqliteWorkbenchRepository {
  constructor(readonly database: DatabaseSync) {}

  createDiscoveryJob(rawInput: { query: string; channel?: "venture_tech" | "registry" | "hiring" | "ranking_award"; queryFamily?: string; tracks?: readonly Track[]; subtracks?: readonly string[]; cities?: readonly string[]; institutions?: readonly string[]; since?: string; dateWindowDays?: number; preferredDomains?: readonly string[]; sourceScope?: "approved_public" | "licensed_internal" | "all_approved"; resultLimit?: number }, idempotencyKey: string, actorId: string) {
    requireIdempotencyKey(idempotencyKey);
    const identity = identityScope.getStore();
    const requesterId = identity?.accountId ?? actorId;
    const input = discoveryJobInputSchema.parse({ ...rawInput, tracks: rawInput.tracks ? [...rawInput.tracks] : undefined, subtracks: rawInput.subtracks ? [...rawInput.subtracks] : undefined, cities: rawInput.cities ? [...rawInput.cities] : undefined, institutions: rawInput.institutions ? [...rawInput.institutions] : undefined, preferredDomains: rawInput.preferredDomains ? [...rawInput.preferredDomains] : undefined });
    const payload = stableJson(input);
    const existing = this.database.prepare("SELECT * FROM discovery_jobs WHERE requested_by=? AND idempotency_key=?").get(requesterId, idempotencyKey) as Record<string, string> | undefined;
    if (existing) {
      if (existing.query_json !== payload) throw new Error("幂等键已用于不同请求。");
      if (identity) bindJobAIRequester(this.database, "discovery", existing.id, identity);
      return mapDiscoveryJob(existing);
    }
    const now = new Date().toISOString();
    const id = randomUUID();
    this.database.exec("BEGIN IMMEDIATE");
    try {
    this.database.prepare(`INSERT INTO discovery_jobs
      (id,query_json,requested_by,idempotency_key,status,workflow_id,workflow_version,provider_id,provider_version,created_at)
      VALUES (?,?,?,?,'queued','project-discovery','1.1.0',?,'1.0.0',?)`).run(id, payload, requesterId, idempotencyKey, identity ? personalSearchMode(this.database, identity) : 'configured-search', now);
    if (identity) bindJobAIRequester(this.database, "discovery", id, identity);
    this.database.exec("COMMIT");
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
    return this.listDiscoveryJobs().find((job) => job.id === id)!;
  }

  listDiscoveryJobs() {
    const rows = this.database.prepare("SELECT * FROM discovery_jobs ORDER BY created_at DESC,id DESC").all() as unknown as Array<Record<string, string>>;
    return rows.map(mapDiscoveryJob);
  }

  listCandidates(filters: CandidateQueueFilters = {}, now = new Date()): CandidateView[] {
    archiveUnassignedCandidates(this.database, now);
    return filterCandidateQueue(this.readCandidateViews(), filters, now);
  }

  findCandidate(id: string): CandidateView | undefined { return this.readCandidateViews(id)[0]; }

  private readCandidateViews(id?: string): CandidateView[] {
    const rows = this.database.prepare(`SELECT pc.*,cd.import_key AS details_import_key,wsl.title,wsl.url,wsl.published_at,wsl.publication_verified_at,cd.origin,cd.event_date,cd.round,cd.amount_text,cd.valuation,
      cd.raw_track,cd.event_type,cd.sources_json,cd.verification_notes,cd.source_screenshot,cd.source_row FROM project_candidates pc
      JOIN web_search_leads wsl ON wsl.id=pc.lead_id LEFT JOIN candidate_details cd ON cd.candidate_id=pc.id WHERE (? IS NULL OR pc.id=?)
      ORDER BY CASE WHEN cd.candidate_id IS NOT NULL THEN cd.event_date ELSE coalesce(substr(wsl.published_at,1,10),substr(pc.created_at,1,10)) END DESC,pc.created_at DESC,pc.id DESC`).all(id ?? null, id ?? null) as unknown as Array<Record<string, string | number | null>>;
    return rows.map((row) => ({
      id: String(row.id), companyName: String(row.company_name), track: String(row.track), investorNames: JSON.parse(String(row.investor_names_json)) as string[],
      signalType: String(row.signal_type), summary: String(row.summary), confidence: row.origin === "manual_screenshot" && !String(row.details_import_key).startsWith("admin-edit:") ? null : Number(row.confidence), status: String(row.status),
      version: Number(row.review_version), lead: { title: String(row.title), url: String(row.url), publishedAt: row.published_at ? String(row.published_at) : null, publicationVerifiedAt: row.publication_verified_at ? String(row.publication_verified_at) : null },
      projectId: row.promoted_project_id ? String(row.promoted_project_id) : null, createdAt: String(row.created_at),
      origin: row.origin === "manual_screenshot" && !String(row.details_import_key).startsWith("admin-edit:") ? "manual_screenshot" : "ai", eventDate: row.event_date ? String(row.event_date) : null,
      round: row.round ? String(row.round) : null, amountText: row.amount_text ? String(row.amount_text) : null, valuation: row.valuation ? String(row.valuation) : null,
      rawTrack: row.raw_track ? String(row.raw_track) : null, eventType: row.event_type ? String(row.event_type) : null,
      sources: row.sources_json ? JSON.parse(String(row.sources_json)) as CandidateSource[] : [],
      verificationNotes: row.verification_notes ? String(row.verification_notes) : null,
      sourceScreenshot: row.source_screenshot ? String(row.source_screenshot) : null, sourceRow: row.source_row ? String(row.source_row) : null,
      archivedAt: row.archived_at ? String(row.archived_at) : null, archiveReason: row.archive_reason ? String(row.archive_reason) : null, queueRank: Number(row.queue_rank ?? 1000000), reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
    }));
  }

  reviewCandidate(candidateId: string, rawInput: CandidateReviewInput, idempotencyKey: string, actorId: string) {
    requireIdempotencyKey(idempotencyKey);
    const input = candidateReviewSchema.parse({ ...rawInput, reason: rawInput.reason ?? "" });
    const candidate = this.database.prepare("SELECT * FROM project_candidates WHERE id=?").get(candidateId) as Record<string, string | number | null> | undefined;
    if (!candidate) throw new Error("候选不存在。");
    if (candidate.review_idempotency_key === idempotencyKey) return candidateReviewResult(candidate);
    if (Number(candidate.review_version) !== input.expectedVersion) throw new Error("版本冲突：候选已发生变化。");
    if (candidate.status !== "pending_review") throw new Error("候选已完成复核。");
    const reviewedTrack = input.track ?? String(candidate.track);
    if (input.decision === "promote" && !TRACK_VALUES.includes(reviewedTrack as Track)) throw new Error("请先确认有效的正式项目赛道，原始赛道仍保留在候选详情中。");
    const team = input.decision === "promote" ? loadTeamMembers() : [];
    const responsibles = input.decision === "promote" ? normalizeResponsibles(input, team, false) : [];
    const owners = responsibles.map(member => member.name);
    const assignee = owners[0];
    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      let projectId: string | null = null;
      if (input.decision === "promote") {
        const companyName = String(candidate.company_name);
        const existingCompany = this.database.prepare("SELECT id FROM companies WHERE legal_name=? ORDER BY id LIMIT 1").get(companyName) as { id: string } | undefined;
        const companyId = existingCompany?.id ?? randomUUID();
        if (!existingCompany) this.database.prepare("INSERT INTO companies (id,legal_name,aliases_json,official_domain,region_scope) VALUES (?,?,'[]',NULL,'中国')").run(companyId, companyName);
        projectId = randomUUID();
        const suggestedOwner = suggestOwner(team, { track: reviewedTrack, subtrack: "待分类" });
        this.database.prepare(`INSERT INTO projects
          (id,company_id,name,track,subtrack,discovery_at,discovery_reason,status,executive_summary,technology_stage,
           urgency_score,quality_score,evidence_quality,owner,signal_type,latest_event_at,risk_flags_json,open_questions_json,version,last_researched_at,
           score_urgency,score_quality,score_evidence,suggested_owner_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,-1,-1,-1,?,?,?,?, ?,1,?,NULL,NULL,NULL,?)`).run(
          projectId, companyId, companyName, reviewedTrack, "待分类", now, "人工复核搜索候选后正式入库", "new",
          String(candidate.summary), "待评估", assignee ?? null, String(candidate.signal_type), now, "[]", "[]", now, suggestedOwner?.id ?? null,
        );
        replaceProjectResponsibles(this.database, projectId, responsibles, now);
        notifyProjectCreated(this.database, { id: projectId, name: companyName }, actorId, now, team);
        insertNotifications(this.database, { recipientIds: responsibles.map(member => member.id), actorId, kind: "project_assigned", projectId, message: `你被指定为项目「${companyName}」的负责人`, targetUrl: `/projects/${encodeURIComponent(projectId)}`, createdAt: now });
        if (responsibles[0]) this.database.prepare("UPDATE projects SET owner_id=? WHERE id=?").run(responsibles[0].id, projectId);
        if (assignee) this.insertTimeline("project.assigned", "project", projectId, projectId, actorId, `项目已分配给 ${owners.join("、")}`, { previousOwner: null, owner: assignee, ...(owners.length > 1 ? { owners } : {}) }, idempotencyKey, now);
      }
      const status = input.decision === "promote" ? "promoted" : "dismissed";
      const result = this.database.prepare(`UPDATE project_candidates SET status=?,track=?,reviewed_by=?,reviewed_at=?,review_reason=?,promoted_project_id=?,
        review_idempotency_key=?,review_version=review_version+1,updated_at=?,archived_at=NULL,archive_reason=NULL WHERE id=? AND review_version=?`).run(
        status, input.decision === "promote" ? reviewedTrack : String(candidate.track), actorId, now, input.reason, projectId, idempotencyKey, now, candidateId, input.expectedVersion,
      );
      if (Number(result.changes) !== 1) throw new Error("版本冲突：候选已发生变化。");
      this.insertTimeline("candidate.reviewed", "project_candidate", candidateId, projectId, actorId, input.decision === "promote" ? "候选已正式入库" : "候选已拒绝", { decision: input.decision }, idempotencyKey, now);
      this.database.exec("COMMIT");
      return { id: candidateId, status, version: input.expectedVersion + 1, projectId };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  addJudgment(projectId: string, rawInput: JudgmentInput, idempotencyKey: string, actorId: string) {
    requireIdempotencyKey(idempotencyKey);
    const input = judgmentInputSchema.parse(rawInput);
    const duplicate = this.database.prepare("SELECT id FROM project_judgments WHERE actor_id=? AND idempotency_key=?").get(actorId, idempotencyKey) as { id: string } | undefined;
    if (duplicate) {
      const version = Number((this.database.prepare("SELECT version FROM projects WHERE id=?").get(projectId) as { version: number }).version);
      return { id: duplicate.id, projectVersion: version };
    }
    const project = this.database.prepare("SELECT version FROM projects WHERE id=?").get(projectId) as { version: number } | undefined;
    if (!project) throw new Error("项目不存在。");
    if (Number(project.version) !== input.expectedVersion) throw new Error("版本冲突：项目已发生变化。");
    const now = new Date().toISOString();
    const id = randomUUID();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`INSERT INTO project_judgments (id,project_id,actor_id,stance,thesis,occurred_at,idempotency_key,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(id, projectId, actorId, input.stance, input.thesis, input.occurredAt, idempotencyKey, now);
      const updated = this.database.prepare("UPDATE projects SET version=version+1,latest_event_at=? WHERE id=? AND version=?").run(input.occurredAt, projectId, input.expectedVersion);
      if (Number(updated.changes) !== 1) throw new Error("版本冲突：项目已发生变化。");
      this.insertTimeline("judgment.recorded", "project_judgment", id, projectId, actorId, "投资判断已记录", { stance: input.stance }, idempotencyKey, now);
      this.database.exec("COMMIT");
      return { id, projectVersion: input.expectedVersion + 1 };
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  getTimeline(projectId: string): TimelineEntry[] {
    const entries: TimelineEntry[] = [];
    const facts = this.database.prepare("SELECT id,title,summary,occurred_at FROM events WHERE project_id=?").all(projectId) as unknown as Array<Record<string, string>>;
    for (const row of facts) entries.push({ id: row.id, projectId, kind: "fact", title: row.title, summary: row.summary, actor: null, occurredAt: row.occurred_at, metadata: {} });
    const docs = this.database.prepare("SELECT id,original_name,parse_status,analysis_status,uploaded_by,created_at FROM project_documents WHERE project_id=?").all(projectId) as unknown as Array<Record<string, string>>;
    for (const row of docs) entries.push({ id: row.id, projectId, kind: "document", title: row.original_name, summary: `解析 ${row.parse_status} · 分析 ${row.analysis_status}`, actor: row.uploaded_by, occurredAt: row.created_at, metadata: { parseStatus: row.parse_status, analysisStatus: row.analysis_status } });
    const documentEvents = this.database.prepare("SELECT id,document_id,title,summary,occurred_at,confidence FROM document_extracted_events WHERE project_id=?").all(projectId) as unknown as Array<Record<string, string | number>>;
    for (const row of documentEvents) entries.push({ id: String(row.id), projectId, kind: "document", title: String(row.title), summary: String(row.summary), actor: "background-agent", occurredAt: String(row.occurred_at), metadata: { documentId: row.document_id, confidence: Number(row.confidence) } });
    const judgments = this.database.prepare("SELECT id,actor_id,stance,thesis,occurred_at FROM project_judgments WHERE project_id=?").all(projectId) as unknown as Array<Record<string, string>>;
    for (const row of judgments) entries.push({ id: row.id, projectId, kind: "judgment", title: row.thesis, summary: `判断倾向：${row.stance}`, actor: row.actor_id, occurredAt: row.occurred_at, metadata: { stance: row.stance } });
    const reports = this.database.prepare("SELECT id,summary,status,model,created_at FROM research_reports WHERE project_id=?").all(projectId) as unknown as Array<Record<string, string>>;
    for (const row of reports) entries.push({ id: row.id, projectId, kind: "research", title: "研究报告", summary: row.summary, actor: row.model, occurredAt: row.created_at, metadata: { status: row.status } });
    const agent = this.database.prepare("SELECT id,event_type,actor,summary,metadata_json,created_at FROM platform_timeline WHERE project_id=?").all(projectId) as unknown as Array<Record<string, string>>;
    for (const row of agent) entries.push({ id: row.id, projectId, kind: row.event_type.startsWith("project.") ? "audit" : "agent", title: row.event_type, summary: row.summary, actor: row.actor, occurredAt: row.created_at, metadata: JSON.parse(row.metadata_json) });
    return entries.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id));
  }

  createKnowledgeDraft(input: { projectId?: string; track?: string; type: string; title: string; content: string; sourceType: "document" | "research_report" | "evidence"; sourceId: string }, actorId = "background-agent") {
    assertKnowledgeSource(this.database, input.sourceType, input.sourceId);
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.prepare(`INSERT INTO knowledge_entries
      (id,project_id,track,type,title,content,source_type,source_id,status,version,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,'draft',1,?,?,?)`).run(id, input.projectId ?? null, input.track ?? null, input.type, input.title, input.content, input.sourceType, input.sourceId, actorId, now, now);
    return { id, status: "draft" as const, version: 1 };
  }

  listKnowledge(filters: { status?: string; track?: string; projectId?: string; type?: string } = {}) {
    const rows = this.database.prepare("SELECT * FROM knowledge_entries ORDER BY created_at DESC,id DESC").all() as unknown as Array<Record<string, string | number | null>>;
    return rows.filter((row) => (!filters.status || row.status === filters.status) && (!filters.track || row.track === filters.track) && (!filters.projectId || row.project_id === filters.projectId) && (!filters.type || row.type === filters.type)).map(mapKnowledge);
  }

  reviewKnowledge(id: string, rawInput: { decision: "approve" | "reject"; expectedVersion: number; note?: string }, idempotencyKey: string, actorId: string) {
    requireIdempotencyKey(idempotencyKey);
    const input = knowledgeReviewSchema.parse({ ...rawInput, note: rawInput.note ?? "" });
    const prior = this.getIdempotency(actorId, idempotencyKey);
    if (prior) return mapKnowledge(this.database.prepare("SELECT * FROM knowledge_entries WHERE id=?").get(prior.resource_id) as Record<string, string | number | null>);
    const current = this.database.prepare("SELECT * FROM knowledge_entries WHERE id=?").get(id) as Record<string, string | number | null> | undefined;
    if (!current) throw new Error("知识条目不存在。");
    if (Number(current.version) !== input.expectedVersion) throw new Error("版本冲突：知识条目已发生变化。");
    if (current.status !== "draft") throw new Error("只有草稿可以审核。");
    const now = new Date().toISOString();
    const status = input.decision === "approve" ? "approved" : "rejected";
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = this.database.prepare(`UPDATE knowledge_entries SET status=?,version=version+1,reviewed_by=?,reviewed_at=?,review_note=?,updated_at=?
        WHERE id=? AND version=?`).run(status, actorId, now, input.note, now, id, input.expectedVersion);
      if (Number(result.changes) !== 1) throw new Error("版本冲突：知识条目已发生变化。");
      this.recordIdempotency(actorId, idempotencyKey, "knowledge.review", id, input, now);
      this.database.exec("COMMIT");
      return mapKnowledge(this.database.prepare("SELECT * FROM knowledge_entries WHERE id=?").get(id) as Record<string, string | number | null>);
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  private getIdempotency(actorId: string, key: string) {
    return this.database.prepare("SELECT * FROM workbench_idempotency WHERE actor_id=? AND idempotency_key=?").get(actorId, key) as Record<string, string> | undefined;
  }
  private recordIdempotency(actorId: string, key: string, action: string, resourceId: string, payload: unknown, now: string) {
    this.database.prepare("INSERT INTO workbench_idempotency (actor_id,idempotency_key,action,resource_id,payload_json,created_at) VALUES (?,?,?,?,?,?)").run(actorId, key, action, resourceId, stableJson(payload), now);
  }
  private insertTimeline(eventType: string, subjectType: string, subjectId: string, projectId: string | null, actor: string, summary: string, metadata: unknown, traceId: string, now: string) {
    this.database.prepare(`INSERT INTO platform_timeline (id,event_type,subject_type,subject_id,project_id,actor,summary,metadata_json,trace_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), eventType, subjectType, subjectId, projectId, actor, summary, JSON.stringify(metadata), traceId, now);
  }
}

function mapDiscoveryJob(row: Record<string, string>) {
  return { id: row.id, query: JSON.parse(row.query_json), requestedBy: row.requested_by, status: row.status, workflow: { id: row.workflow_id, version: row.workflow_version }, provider: { id: row.provider_id, version: row.provider_version }, attemptCount: Number(row.attempt_count ?? 0), errorCode: row.error_code ?? null, createdAt: row.created_at, startedAt: row.started_at ?? null, finishedAt: row.finished_at ?? null };
}
function candidateReviewResult(row: Record<string, string | number | null>) { return { id: String(row.id), status: String(row.status), version: Number(row.review_version), projectId: row.promoted_project_id ? String(row.promoted_project_id) : null }; }
function mapKnowledge(row: Record<string, string | number | null>) { return { id: String(row.id), projectId: row.project_id ? String(row.project_id) : null, track: row.track ? String(row.track) : null, type: String(row.type), title: String(row.title), content: String(row.content), sourceType: String(row.source_type), sourceId: String(row.source_id), status: String(row.status), version: Number(row.version), createdBy: String(row.created_by), reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function requireIdempotencyKey(key: string) { if (!key.trim()) throw new Error("写操作必须提供 Idempotency-Key。"); }
function stableJson(value: unknown) { return JSON.stringify(value, Object.keys(value as object).sort()); }
function assertKnowledgeSource(database: DatabaseSync, type: string, id: string) {
  const table = type === "document" ? "project_documents" : type === "research_report" ? "research_reports" : "evidence_fragments";
  const found = database.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(id);
  if (!found) throw new Error("知识草稿必须关联有效资料、研究报告或 Evidence。");
}
