import { insertNotifications } from "@/workbench/notifications";
import { normalizeResponsibles, replaceProjectResponsibles } from "@/workbench/project-responsibles";
import { loadTeamMembers } from "@/workbench/team";
import { stageLabel } from "@/workbench/deal-stages";
import { SOURCE_MAY_USE_EXTERNAL_MODEL_SQL } from "@/security/source-policy";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { LeadStatus, ProjectSummary, SourceAuthority, Track, ValueStatus, EpistemicType } from "@/domain/types";

interface ProjectRow {
  id: string;
  company_id: string;
  name: string;
  legal_name: string;
  official_domain: string | null;
  unified_credit_code: string | null;
  track: Track;
  subtrack: string;
  status: LeadStatus;
  urgency_score: number;
  quality_score: number;
  evidence_quality: number;
  score_urgency: number | null;
  score_quality: number | null;
  score_evidence: number | null;
  evidence_authority: SourceAuthority | null;
  discovery_reason: string;
  owner: string | null;
  owners_json: string;
  signal_type: string;
  latest_event_at: string;
  risk_flags_json: string;
  executive_summary: string;
  technology_stage: string;
  deal_stage: string;
  open_questions_json: string;
  version: number;
  last_researched_at: string;
}

interface AssertionRow {
  id: string;
  predicate: string;
  label: string;
  value_status: ValueStatus;
  epistemic_type: EpistemicType;
  value_json: string | null;
  unit: string | null;
  null_reason: string | null;
  confidence: number;
  extraction_method: string;
  model_version: string;
  status: "active" | "disputed" | "superseded" | "retracted";
  valid_from: string | null;
  valid_to: string | null;
}

interface EvidenceRow {
  id: string;
  quoted_context: string;
  document_id: string;
  title: string;
  canonical_url: string;
  published_at: string;
  observed_at: string;
  content_hash: string;
  source_name: string;
  authority: "A" | "B" | "C" | "D";
  independent_group: string;
  model_shareable: number;
}

export interface EvidenceView {
  id: string;
  quote: string;
  documentId: string;
  title: string;
  url: string;
  publishedAt: string;
  observedAt: string;
  contentHash: string;
  sourceName: string;
  authority: "A" | "B" | "C" | "D";
  independentGroup: string;
  modelShareable: boolean;
}

export interface AssertionView {
  id: string;
  predicate: string;
  label: string;
  valueStatus: ValueStatus;
  epistemicType: EpistemicType;
  value: unknown;
  unit: string | null;
  nullReason: string | null;
  confidence: number;
  extractionMethod: string;
  modelVersion: string;
  status: "active" | "disputed" | "superseded" | "retracted";
  validFrom: string | null;
  validTo: string | null;
  evidence: EvidenceView[];
}

export interface ProjectDetail extends ProjectSummary {
  executiveSummary: string;
  technologyStage: string;
  dealStage: string;
  openQuestions: string[];
  version: number;
  lastResearchedAt: string;
  assertions: AssertionView[];
  events: Array<{ id: string; type: string; occurredAt: string; title: string; summary: string; confidence: number; evidenceId: string }>;
  researchReports: Array<{ id: string; model: string; status: string; summary: string; findings: Array<{ claim: string; evidenceIds: string[] }>; risks: string[]; openQuestions: string[]; createdAt: string }>;
  agentTimeline: Array<{ id: string; type: string; actor: string; summary: string; metadata: unknown; createdAt: string }>;
  companyIntelligence?: {
    unifiedCreditCode: string | null; officialWebsite: string | null;
    registeredAddress: string | null; researchLocations: string[]; businessScope: string | null; products: string[]; coreTechnologies: string[]; competitors: string[];
    team: Array<{ id: string; name: string; role: string; organization: string | null; title: string | null; education: string[]; technicalBackground: string | null }>;
    financing: Array<{ id: string; round: string; announcedAt: string; amount: number | null; currency: string | null; disclosureType: string; valuation: number | null; investors: string[] }>;
    mergersAndAcquisitions: Array<{ id: string; acquirerName: string; announcementDate: string; transactionType: string; transactionValue: number | null; currency: string | null; transactionStage: string; strategicRationale: string | null }>;
    contacts: Array<{ type: string; value: string; sourceUrl: string; verifiedAt: string }>;
  };
}

export interface ReviewInput {
  projectId: string;
  expectedVersion: number;
  status: LeadStatus;
  dealStage?: string;
  reviewer: string;
  note: string;
  requestId: string;
}

export interface AssignmentInput {
  projectId: string;
  expectedVersion: number;
  assignee?: string;
  assignees?: string[];
  reviewer: string;
  requestId: string;
}

export interface EvidenceRequestInput {
  projectId: string;
  expectedVersion: number;
  reviewer: string;
  note: string;
  requestId: string;
}

export interface AuditEvent {
  id: string;
  actor: string;
  action: string;
  resourceId: string;
  before: unknown;
  after: unknown;
  note: string;
  requestId: string;
  createdAt: string;
}

const PROJECT_SELECT = `SELECT p.*, c.legal_name,c.official_domain,c.unified_credit_code,
  (SELECT json_group_array(member_name) FROM (SELECT member_name FROM project_responsibles WHERE project_id=p.id ORDER BY position)) AS owners_json,
  (SELECT MIN(s.authority)
    FROM assertions a
    JOIN assertion_evidence ae ON ae.assertion_id = a.id
    JOIN evidence_fragments ef ON ef.id = ae.evidence_id
    JOIN documents d ON d.id = ef.document_id
    JOIN sources s ON s.id = d.source_id
    WHERE a.project_id = p.id) AS evidence_authority
  FROM projects p JOIN companies c ON c.id = p.company_id`;

export class SqliteProjectRepository {
  constructor(private readonly database: DatabaseSync) {}

  list(): ProjectSummary[] {
    const rows = this.database.prepare(`${PROJECT_SELECT} ORDER BY coalesce(p.score_urgency,nullif(p.urgency_score,-1)) IS NULL, coalesce(p.score_urgency,nullif(p.urgency_score,-1)) DESC, p.latest_event_at DESC`).all() as unknown as ProjectRow[];
    return rows.map(mapSummary);
  }

  findById(id: string): ProjectDetail | undefined {
    const row = this.database.prepare(`${PROJECT_SELECT} WHERE p.id = ?`).get(id) as unknown as ProjectRow | undefined;
    if (!row) return undefined;

    const assertionRows = this.database.prepare("SELECT * FROM assertions WHERE project_id = ? ORDER BY predicate, confidence DESC").all(id) as unknown as AssertionRow[];
    const evidenceStatement = this.database.prepare(`SELECT ef.id, ef.quoted_context, d.id AS document_id, d.title, d.canonical_url, d.published_at, d.observed_at, d.content_hash, s.name AS source_name, s.authority, s.independent_group,
      CASE WHEN ${SOURCE_MAY_USE_EXTERNAL_MODEL_SQL} THEN 1 ELSE 0 END AS model_shareable
      FROM assertion_evidence ae
      JOIN evidence_fragments ef ON ef.id = ae.evidence_id
      JOIN documents d ON d.id = ef.document_id
      JOIN sources s ON s.id = d.source_id
      WHERE ae.assertion_id = ?`);
    const assertions = assertionRows.map((assertion) => ({
      id: assertion.id,
      predicate: assertion.predicate,
      label: assertion.label,
      valueStatus: assertion.value_status,
      epistemicType: assertion.epistemic_type,
      value: assertion.value_json === null ? null : JSON.parse(assertion.value_json),
      unit: assertion.unit,
      nullReason: assertion.null_reason,
      confidence: assertion.confidence,
      extractionMethod: assertion.extraction_method,
      modelVersion: assertion.model_version,
      status: assertion.status,
      validFrom: assertion.valid_from,
      validTo: assertion.valid_to,
      evidence: (evidenceStatement.all(assertion.id) as unknown as EvidenceRow[]).map(mapEvidence),
    }));
    const events = this.database.prepare("SELECT id,event_type,occurred_at,title,summary,confidence,evidence_id FROM events WHERE project_id = ? ORDER BY occurred_at DESC").all(id) as unknown as Array<Record<string, string | number>>;
    const reports = this.database.prepare(`SELECT id,model,status,summary,findings_json,risks_json,open_questions_json,created_at
      FROM research_reports WHERE project_id=? ORDER BY created_at DESC,id DESC`).all(id) as unknown as Array<Record<string, string>>;
    const timeline = this.database.prepare(`SELECT id,event_type,actor,summary,metadata_json,created_at
      FROM platform_timeline WHERE project_id=? ORDER BY created_at DESC,id DESC`).all(id) as unknown as Array<Record<string, string>>;
    const profile = this.database.prepare("SELECT * FROM company_profiles WHERE company_id=?").get(row.company_id) as Record<string, string | null> | undefined;
    const teamRows = this.database.prepare(`SELECT p.id,p.name,p.current_organization,p.current_title,r.role,d.education_json,d.technical_background
      FROM person_company_roles r JOIN people p ON p.id=r.person_id LEFT JOIN person_profile_details d ON d.person_id=p.id
      WHERE r.company_id=? ORDER BY p.name`).all(row.company_id) as unknown as Array<Record<string, string | null>>;
    const relationshipTeamRows = this.database.prepare(`SELECT er.id,er.target_entity_id,er.target_name,er.relation_type,p.current_organization,p.current_title,d.education_json,d.technical_background
      FROM entity_relationships er LEFT JOIN people p ON p.id=er.target_entity_id LEFT JOIN person_profile_details d ON d.person_id=p.id
      WHERE er.source_entity_type='company' AND er.source_entity_id=? AND er.target_entity_type='person'
      ORDER BY er.target_name`).all(row.company_id) as unknown as Array<Record<string, string | null>>;
    const financingRows = this.database.prepare("SELECT id,round,announced_at,amount,currency,disclosure_type,valuation,investors_json FROM investment_events WHERE company_id=? ORDER BY announced_at DESC").all(row.company_id) as unknown as Array<Record<string, string | number | null>>;
    const maRows = this.database.prepare("SELECT id,acquirer_name,announcement_date,transaction_type,transaction_value,currency,transaction_stage,strategic_rationale FROM ma_events WHERE target_company_id=? ORDER BY announcement_date DESC").all(row.company_id) as unknown as Array<Record<string, string | number | null>>;
    const contactRows = this.database.prepare("SELECT contact_type,contact_value,source_url,verified_at FROM entity_public_contacts WHERE entity_type='company' AND entity_id=? ORDER BY verified_at DESC").all(row.company_id) as unknown as Array<Record<string, string>>;

    const team = teamRows.map((person) => ({ id: String(person.id), name: String(person.name), role: String(person.role), organization: person.current_organization, title: person.current_title, education: person.education_json ? JSON.parse(person.education_json) as string[] : [], technicalBackground: person.technical_background }));
    for (const person of relationshipTeamRows) {
      const related = { id: String(person.target_entity_id ?? person.id), name: String(person.target_name), role: String(person.relation_type), organization: person.current_organization, title: person.current_title, education: person.education_json ? JSON.parse(person.education_json) as string[] : [], technicalBackground: person.technical_background };
      if (!team.some((member) => (person.target_entity_id && member.id === person.target_entity_id) || (member.name === related.name && member.role === related.role))) team.push(related);
    }

    return {
      ...mapSummary(row),
      executiveSummary: row.executive_summary,
      technologyStage: row.technology_stage,
      dealStage: row.deal_stage,
      openQuestions: JSON.parse(row.open_questions_json) as string[],
      version: row.version,
      lastResearchedAt: row.last_researched_at,
      assertions,
      events: events.map((event) => ({ id: String(event.id), type: String(event.event_type), occurredAt: String(event.occurred_at), title: String(event.title), summary: String(event.summary), confidence: Number(event.confidence), evidenceId: String(event.evidence_id) })),
      researchReports: reports.map((report) => ({ id: report.id, model: report.model, status: report.status, summary: report.summary, findings: JSON.parse(report.findings_json), risks: JSON.parse(report.risks_json), openQuestions: JSON.parse(report.open_questions_json), createdAt: report.created_at })),
      agentTimeline: timeline.map((event) => ({ id: event.id, type: event.event_type, actor: event.actor, summary: event.summary, metadata: JSON.parse(event.metadata_json), createdAt: event.created_at })),
      companyIntelligence: {
        unifiedCreditCode: row.unified_credit_code ?? null,
        officialWebsite: row.official_domain ? `https://${row.official_domain}` : null,
        registeredAddress: profile?.registered_address ?? null,
        researchLocations: profile ? JSON.parse(String(profile.research_locations_json)) as string[] : [],
        businessScope: profile?.business_scope ?? null,
        products: profile ? JSON.parse(String(profile.products_json)) as string[] : [],
        coreTechnologies: profile ? JSON.parse(String(profile.core_technologies_json)) as string[] : [],
        competitors: profile ? JSON.parse(String(profile.competitors_json)) as string[] : [],
        team,
        financing: financingRows.map((event) => ({ id: String(event.id), round: String(event.round), announcedAt: String(event.announced_at), amount: event.amount === null ? null : Number(event.amount), currency: event.currency ? String(event.currency) : null, disclosureType: String(event.disclosure_type), valuation: event.valuation === null ? null : Number(event.valuation), investors: JSON.parse(String(event.investors_json)) as string[] })),
        mergersAndAcquisitions: maRows.map((event) => ({ id: String(event.id), acquirerName: String(event.acquirer_name), announcementDate: String(event.announcement_date), transactionType: String(event.transaction_type), transactionValue: event.transaction_value === null ? null : Number(event.transaction_value), currency: event.currency ? String(event.currency) : null, transactionStage: String(event.transaction_stage), strategicRationale: event.strategic_rationale ? String(event.strategic_rationale) : null })),
        contacts: contactRows.map((contact) => ({ type: contact.contact_type, value: contact.contact_value, sourceUrl: contact.source_url, verifiedAt: contact.verified_at })),
      },
    };
  }

  findEvidenceById(id: string): EvidenceView | undefined {
    const row = this.database.prepare(`SELECT ef.id, ef.quoted_context, d.id AS document_id, d.title, d.canonical_url, d.published_at, d.observed_at, d.content_hash, s.name AS source_name, s.authority, s.independent_group,
      CASE WHEN ${SOURCE_MAY_USE_EXTERNAL_MODEL_SQL} THEN 1 ELSE 0 END AS model_shareable
      FROM evidence_fragments ef
      JOIN documents d ON d.id = ef.document_id
      JOIN sources s ON s.id = d.source_id
      WHERE ef.id = ?`).get(id) as unknown as EvidenceRow | undefined;
    return row ? mapEvidence(row) : undefined;
  }

  updateReview(input: ReviewInput): { status: LeadStatus; dealStage: string; dealStageLabel: string; version: number } {
    const repeated = this.database.prepare("SELECT resource_id,after_json,note FROM audit_log WHERE actor=? AND action='project.reviewed' AND request_id=?").get(input.reviewer, input.requestId) as { resource_id: string; after_json: string; note: string } | undefined;
    if (repeated) {
      const after = JSON.parse(repeated.after_json) as { status: LeadStatus; dealStage?: string; dealStageLabel?: string; manual?: boolean; version: number };
      const sameRequest = repeated.resource_id === input.projectId
        && after.status === input.status
        && after.version === input.expectedVersion + 1
        && repeated.note === input.note
        && Boolean(after.manual) === (input.dealStage !== undefined)
        && (input.dealStage === undefined || after.dealStage === input.dealStage);
      if (!sameRequest) throw new Error("幂等键已用于其他项目变更请求。");
      const project = this.findById(input.projectId);
      const dealStage = after.dealStage ?? project?.dealStage ?? "contact";
      return { status: after.status, dealStage, dealStageLabel: after.dealStageLabel ?? stageLabel(dealStage), version: after.version };
    }
    const row = this.database.prepare("SELECT status,deal_stage,version,owner FROM projects WHERE id = ?").get(input.projectId) as { status: LeadStatus; deal_stage: string; version: number; owner: string | null } | undefined;
    if (!row) throw new Error("Project not found.");
    if (row.version !== input.expectedVersion) throw new Error("Version conflict: project has changed.");
    const current = { status: row.status, dealStage: row.deal_stage, version: row.version, owner: row.owner };
    const dealStage = input.dealStage ?? current.dealStage;
    const dealStageLabel = stageLabel(dealStage);

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = this.database.prepare("UPDATE projects SET status=?,deal_stage=?,version=version+1,latest_event_at=? WHERE id=? AND version=?").run(input.status, dealStage, new Date().toISOString(), input.projectId, input.expectedVersion);
      if (result.changes !== 1) throw new Error("Version conflict: project has changed.");
      const next = { status: input.status, dealStage, dealStageLabel, manual: input.dealStage !== undefined, version: input.expectedVersion + 1, owner: current.owner };
      this.database.prepare(`INSERT INTO audit_log
        (id,actor,action,resource_type,resource_id,before_json,after_json,note,request_id,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), input.reviewer, "project.reviewed", "project", input.projectId, JSON.stringify(current), JSON.stringify(next), input.note, input.requestId, new Date().toISOString());
      const eventType = input.dealStage ? "project.stage_manually_selected" : "project.stage_changed";
      const summary = input.dealStage ? `项目阶段已手动调整为 ${dealStageLabel}` : `项目阶段已更新为 ${input.status}`;
      this.database.prepare(`INSERT INTO platform_timeline (id,event_type,subject_type,subject_id,project_id,actor,summary,metadata_json,trace_id,created_at)
        VALUES (?,?,'project',?,?,?,?,?,?,?)`).run(randomUUID(), eventType, input.projectId, input.projectId, input.reviewer, summary, JSON.stringify({ previousStatus: current.status, previousDealStage: current.dealStage, status: input.status, dealStage, dealStageLabel, manual: Boolean(input.dealStage) }), input.requestId, new Date().toISOString());
      this.database.exec("COMMIT");
      return { status: next.status, dealStage: next.dealStage, dealStageLabel: next.dealStageLabel, version: next.version };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  assign(input: AssignmentInput): { owner: string; owners: string[]; version: number } {
    const members = normalizeResponsibles(input, loadTeamMembers());
    const owners = members.map(member => member.name); const owner = owners[0];
    const repeated = this.database.prepare("SELECT resource_id,after_json FROM audit_log WHERE actor=? AND action='project.assigned' AND request_id=?").get(input.reviewer, input.requestId) as { resource_id: string; after_json: string } | undefined;
    if (repeated) {
      const after = JSON.parse(repeated.after_json) as { owner: string; owners?: string[]; version: number };
      if (repeated.resource_id !== input.projectId || JSON.stringify(after.owners ?? [after.owner]) !== JSON.stringify(owners) || after.version !== input.expectedVersion + 1) throw new Error("幂等键已用于其他分配请求。");
      return { owner: after.owner, owners: after.owners ?? [after.owner], version: after.version };
    }
    const current = this.database.prepare("SELECT status,version,owner FROM projects WHERE id = ?").get(input.projectId) as { status: LeadStatus; version: number; owner: string | null } | undefined;
    if (!current) throw new Error("Project not found.");
    if (current.version !== input.expectedVersion) throw new Error("Version conflict: project has changed.");
    const previousOwners = this.findById(input.projectId)?.owners ?? [];
    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = this.database.prepare("UPDATE projects SET owner = ?, owner_id=?, version = version + 1 WHERE id = ? AND version = ?").run(owner, members[0].id, input.projectId, input.expectedVersion);
      if (result.changes !== 1) throw new Error("Version conflict: project has changed.");
      replaceProjectResponsibles(this.database, input.projectId, members, now);
      const projectName = this.database.prepare("SELECT name FROM projects WHERE id=?").get(input.projectId)!.name;
      insertNotifications(this.database, { recipientIds: members.filter(member => !previousOwners.includes(member.name)).map(member => member.id), actorId: input.reviewer, kind: "project_assigned", projectId: input.projectId, message: `你被指定为项目「${String(projectName)}」的负责人`, targetUrl: `/projects/${encodeURIComponent(input.projectId)}`, createdAt: now });
      const next = { status: current.status, version: input.expectedVersion + 1, owner, owners };
      this.database.prepare(`INSERT INTO audit_log
        (id,actor,action,resource_type,resource_id,before_json,after_json,note,request_id,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), input.reviewer, "project.assigned", "project", input.projectId, JSON.stringify({ ...current, owners: previousOwners }), JSON.stringify(next), `分配给 ${owners.join("、")}`, input.requestId, now);
      this.database.prepare(`INSERT INTO platform_timeline (id,event_type,subject_type,subject_id,project_id,actor,summary,metadata_json,trace_id,created_at)
        VALUES (?,'project.assigned','project',?,?,?,?,?,?,?)`).run(randomUUID(), input.projectId, input.projectId, input.reviewer, `项目已分配给 ${owners.join("、")}`, JSON.stringify({ previousOwner: current.owner, owner, previousOwners, owners }), input.requestId, now);
      this.database.exec("COMMIT");
      return { owner, owners, version: next.version };
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  requestEvidence(input: EvidenceRequestInput): { status: "requested"; version: number } {
    const current = this.database.prepare("SELECT status,version,owner FROM projects WHERE id = ?").get(input.projectId) as { status: LeadStatus; version: number; owner: string | null } | undefined;
    if (!current) throw new Error("Project not found.");
    if (this.hasEvidenceRequest(input.projectId)) return { status: "requested", version: current.version };
    if (current.version !== input.expectedVersion) throw new Error("Version conflict: project has changed.");

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = this.database.prepare("UPDATE projects SET status = 'researching', version = version + 1 WHERE id = ? AND version = ?").run(input.projectId, input.expectedVersion);
      if (result.changes !== 1) throw new Error("Version conflict: project has changed.");
      const next = { status: "researching", version: input.expectedVersion + 1, owner: current.owner };
      this.database.prepare(`INSERT INTO audit_log
        (id,actor,action,resource_type,resource_id,before_json,after_json,note,request_id,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), input.reviewer, "project.evidence_requested", "project", input.projectId, JSON.stringify(current), JSON.stringify(next), input.note, input.requestId, new Date().toISOString());
      this.database.exec("COMMIT");
      return { status: "requested", version: next.version };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  hasEvidenceRequest(projectId: string): boolean {
    const row = this.database.prepare("SELECT 1 FROM audit_log WHERE resource_type = 'project' AND resource_id = ? AND action = 'project.evidence_requested' LIMIT 1").get(projectId);
    return Boolean(row);
  }

  listAuditEvents(projectId: string): AuditEvent[] {
    const rows = this.database.prepare("SELECT * FROM audit_log WHERE resource_type = 'project' AND resource_id = ? ORDER BY created_at DESC").all(projectId) as unknown as Array<Record<string, string>>;
    return rows.map((row) => ({ id: row.id, actor: row.actor, action: row.action, resourceId: row.resource_id, before: JSON.parse(row.before_json), after: JSON.parse(row.after_json), note: row.note, requestId: row.request_id, createdAt: row.created_at }));
  }
}

function mapSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    legalName: row.legal_name,
    track: row.track,
    subtrack: row.subtrack,
    status: row.status,
    urgencyScore: row.score_urgency ?? (row.urgency_score >= 0 ? row.urgency_score : undefined),
    qualityScore: row.score_quality ?? (row.quality_score >= 0 ? row.quality_score : undefined),
    evidenceQuality: row.score_evidence ?? (row.evidence_quality >= 0 ? row.evidence_quality : undefined),
    evidenceAuthority: row.evidence_authority ?? undefined,
    whyNow: row.discovery_reason,
    owner: row.owner,
    owners: row.owner ? (JSON.parse(row.owners_json || "[]")[0] === row.owner ? JSON.parse(row.owners_json) : [row.owner]) : [],
    signalType: row.signal_type,
    eventAt: row.latest_event_at,
    riskFlags: JSON.parse(row.risk_flags_json) as string[],
  };
}

function mapEvidence(row: EvidenceRow): EvidenceView {
  return { id: row.id, quote: row.quoted_context, documentId: row.document_id, title: row.title, url: row.canonical_url, publishedAt: row.published_at, observedAt: row.observed_at, contentHash: row.content_hash, sourceName: row.source_name, authority: row.authority, independentGroup: row.independent_group, modelShareable: row.model_shareable === 1 };
}
