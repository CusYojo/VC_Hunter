import { archiveUnassignedCandidates } from "@/workbench/candidate-queue";
import type { DatabaseSync } from "node:sqlite";
import { seedDemoData } from "@/db/seed";

export function ensureDemoData(database: DatabaseSync): void {
  const row = database.prepare("SELECT count(*) AS count FROM projects").get() as { count: number };
  if (row.count === 0) seedDemoData(database);
}

export interface AlertView {
  id: string;
  projectId: string;
  projectName: string;
  track: string;
  severity: string;
  reason: string;
  status: string;
  createdAt: string;
}

export function listAlerts(database: DatabaseSync): AlertView[] {
  const rows = database.prepare(`SELECT a.id, a.project_id, p.name AS project_name, p.track, a.severity, a.reason, a.status, a.created_at
    FROM alerts a JOIN projects p ON p.id = a.project_id
    ORDER BY CASE a.severity WHEN 'high' THEN 1 ELSE 2 END, a.created_at DESC`).all() as unknown as Array<Record<string, string>>;
  return rows.map((row) => ({ id: row.id, projectId: row.project_id, projectName: row.project_name, track: row.track, severity: row.severity, reason: row.reason, status: row.status, createdAt: row.created_at }));
}

export interface KnowledgeCardView {
  id: string;
  track: string;
  definition: string;
  routes: string[];
  milestones: string[];
  keywords: string[];
  queryTemplates: string[];
  updatedAt: string;
}

export function listKnowledgeCards(database: DatabaseSync): KnowledgeCardView[] {
  const rows = database.prepare("SELECT * FROM knowledge_cards ORDER BY rowid").all() as unknown as Array<Record<string, string>>;
  return rows.map((row) => ({ id: row.id, track: row.track, definition: row.definition, routes: JSON.parse(row.routes_json), milestones: JSON.parse(row.milestones_json), keywords: JSON.parse(row.keywords_json), queryTemplates: JSON.parse(row.query_templates_json), updatedAt: row.updated_at }));
}

export interface SourceView {
  id: string;
  name: string;
  type: string;
  authority: string;
  accessMode: string;
  robotsStatus: string;
  policyStatus: string;
  channel: string;
  connectorType: string;
  accessClass: string;
  allowedStorage: string;
  allowExternalModel: boolean;
  frequencyLimit: string | null;
  termsReviewStatus: string;
  credentialConfigured: boolean;
  lastCheckedAt: string;
  documentCount: number;
  connectorStatus: "enabled" | "disabled" | "not_configured";
  lastRunStatus: "running" | "succeeded" | "not_modified" | "failed" | "blocked" | null;
  lastRunAt: string | null;
  lastInsertedCount: number;
  pendingCandidateCount: number;
}

export function listSources(database: DatabaseSync): SourceView[] {
  const rows = database.prepare(`SELECT s.*,
      (SELECT count(*) FROM documents d WHERE d.source_id=s.id) AS document_count,
      CASE WHEN sf.source_id IS NULL THEN 'not_configured' WHEN sf.enabled=1 THEN 'enabled' ELSE 'disabled' END AS connector_status,
      (SELECT cr.status FROM collection_runs cr WHERE cr.source_id=s.id ORDER BY cr.started_at DESC,cr.id DESC LIMIT 1) AS last_run_status,
      (SELECT coalesce(cr.finished_at,cr.started_at) FROM collection_runs cr WHERE cr.source_id=s.id ORDER BY cr.started_at DESC,cr.id DESC LIMIT 1) AS last_run_at,
      coalesce((SELECT cr.inserted_count FROM collection_runs cr WHERE cr.source_id=s.id ORDER BY cr.started_at DESC,cr.id DESC LIMIT 1),0) AS last_inserted_count,
      (SELECT count(*) FROM discovery_candidates dc JOIN documents candidate_document ON candidate_document.id=dc.document_id
        WHERE candidate_document.source_id=s.id AND dc.status='pending_entity_resolution') AS pending_candidate_count
    FROM sources s LEFT JOIN source_feeds sf ON sf.source_id=s.id
    ORDER BY s.authority,s.name`).all() as unknown as Array<Record<string, string | number | null>>;
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    type: String(row.source_type),
    authority: String(row.authority),
    accessMode: String(row.access_mode),
    robotsStatus: String(row.robots_status),
    policyStatus: String(row.policy_status),
    channel: String(row.channel),
    connectorType: String(row.connector_type),
    accessClass: String(row.access_class),
    allowedStorage: String(row.allowed_storage),
    allowExternalModel: Number(row.allow_external_model) === 1,
    frequencyLimit: row.frequency_limit ? String(row.frequency_limit) : null,
    termsReviewStatus: String(row.terms_review_status),
    credentialConfigured: Boolean(row.credential_ref),
    lastCheckedAt: String(row.last_checked_at),
    documentCount: Number(row.document_count),
    connectorStatus: String(row.connector_status) as SourceView["connectorStatus"],
    lastRunStatus: row.last_run_status ? String(row.last_run_status) as SourceView["lastRunStatus"] : null,
    lastRunAt: row.last_run_at ? String(row.last_run_at) : null,
    lastInsertedCount: Number(row.last_inserted_count),
    pendingCandidateCount: Number(row.pending_candidate_count),
  }));
}

export interface DiscoveryCandidateView {
  id: string;
  sourceName: string;
  title: string;
  canonicalUrl: string;
  publishedAt: string;
  matchedTrack: string | null;
  status: string;
  createdAt: string;
}

export function listDiscoveryCandidates(database: DatabaseSync, limit = 100): DiscoveryCandidateView[] {
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 500));
  const rows = database.prepare(`SELECT dc.id,s.name AS source_name,d.title,d.canonical_url,d.published_at,dc.matched_track,dc.status,dc.created_at
    FROM discovery_candidates dc
    JOIN documents d ON d.id=dc.document_id
    JOIN sources s ON s.id=d.source_id
    WHERE dc.status='pending_entity_resolution'
    ORDER BY dc.created_at DESC,dc.id DESC LIMIT ?`).all(safeLimit) as unknown as Array<Record<string, string | null>>;
  return rows.map((row) => ({
    id: String(row.id),
    sourceName: String(row.source_name),
    title: String(row.title),
    canonicalUrl: String(row.canonical_url),
    publishedAt: String(row.published_at),
    matchedTrack: row.matched_track ? String(row.matched_track) : null,
    status: String(row.status),
    createdAt: String(row.created_at),
  }));
}

export interface WebSearchLeadView { id: string; title: string; url: string; publishedAt: string | null; highlights: string[]; lastSeenAt: string; status: string; }

export function listWebSearchLeads(database: DatabaseSync, limit = 100): WebSearchLeadView[] {
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 500));
  const rows = database.prepare(`SELECT id,title,url,published_at,highlights_json,last_seen_at,status FROM web_search_leads
    WHERE status='discovered' ORDER BY last_seen_at DESC,id DESC LIMIT ?`).all(safeLimit) as unknown as Array<Record<string, string | null>>;
  return rows.map((row) => ({ id: String(row.id), title: String(row.title), url: String(row.url), publishedAt: row.published_at ? String(row.published_at) : null, highlights: JSON.parse(String(row.highlights_json)) as string[], lastSeenAt: String(row.last_seen_at), status: String(row.status) }));
}

export interface ProjectCandidateView { id: string; companyName: string; track: string; investorNames: string[]; signalType: string; summary: string; confidence: number; status: string; leadTitle: string; leadUrl: string; updatedAt: string; }

export function listProjectCandidates(database: DatabaseSync, limit = 100, now = new Date()): ProjectCandidateView[] {
  archiveUnassignedCandidates(database, now);
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 500));
  const rows = database.prepare(`SELECT pc.id,pc.company_name,pc.track,pc.investor_names_json,pc.signal_type,pc.summary,pc.confidence,pc.status,
      wsl.title AS lead_title,wsl.url AS lead_url,pc.updated_at
    FROM project_candidates pc JOIN web_search_leads wsl ON wsl.id=pc.lead_id
    WHERE pc.status='pending_review' AND pc.archived_at IS NULL ORDER BY pc.created_at DESC,pc.id DESC LIMIT ?`).all(safeLimit) as unknown as Array<Record<string, string | number>>;
  return rows.map((row) => ({
    id: String(row.id), companyName: String(row.company_name), track: String(row.track),
    investorNames: JSON.parse(String(row.investor_names_json)) as string[], signalType: String(row.signal_type),
    summary: String(row.summary), confidence: Number(row.confidence), status: String(row.status), leadTitle: String(row.lead_title), leadUrl: String(row.lead_url), updatedAt: String(row.updated_at),
  }));
}

export interface AgentSearchPlanView { id: string; name: string; enabled: boolean; nextRunAt: string; lastStartedAt: string | null; lastFinishedAt: string | null; lastStatus: string | null; consecutiveFailures: number; lastErrorCode: string | null; }

export function listAgentSearchPlans(database: DatabaseSync): AgentSearchPlanView[] {
  const rows = database.prepare(`SELECT id,name,enabled,next_run_at,last_started_at,last_finished_at,last_status,consecutive_failures,last_error_code
    FROM agent_search_plans ORDER BY enabled DESC,name`).all() as unknown as Array<Record<string, string | number | null>>;
  return rows.map((row) => ({
    id: String(row.id), name: String(row.name), enabled: Number(row.enabled) === 1, nextRunAt: String(row.next_run_at),
    lastStartedAt: row.last_started_at ? String(row.last_started_at) : null,
    lastFinishedAt: row.last_finished_at ? String(row.last_finished_at) : null,
    lastStatus: row.last_status ? String(row.last_status) : null,
    consecutiveFailures: Number(row.consecutive_failures), lastErrorCode: row.last_error_code ? String(row.last_error_code) : null,
  }));
}
