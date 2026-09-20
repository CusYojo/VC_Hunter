import type { DatabaseSync } from "node:sqlite";
import { IntelligenceDiscoveryRepository, type IntelligenceCandidateView } from "@/intelligence/repository";
import { SqliteProjectRepository } from "@/repositories/projects";
import { SqliteWorkbenchRepository } from "./repository";
import { buildProjectCatalog, type IntelligenceCatalogCandidate, type ProjectCatalogRow } from "./project-catalog";

export function loadProjectCatalog(db: DatabaseSync, localPreviewCandidates: readonly IntelligenceCandidateView[] = []): ProjectCatalogRow[] {
  const workbench = new SqliteWorkbenchRepository(db);
  const intelligenceRepository = new IntelligenceDiscoveryRepository(db);
  const discoveryDates = new Map(db.prepare("SELECT id,discovery_at FROM projects").all().map(row => [String(row.id), String(row.discovery_at)]));
  const editDates = new Map<string, string>();
  const edits = db.prepare("SELECT resource_id,created_at FROM audit_log WHERE resource_type='project_candidate' AND action='candidate.edited'").all();
  for (const edit of edits) {
    const id = String(edit.resource_id), at = String(edit.created_at);
    if (Number.isFinite(Date.parse(at)) && (!editDates.has(id) || Date.parse(at) > Date.parse(editDates.get(id)!))) editDates.set(id, at);
  }
  const projects = new SqliteProjectRepository(db).list().map(project => {
    const latest = workbench.getTimeline(project.id).filter(entry => Number.isFinite(Date.parse(entry.occurredAt)))
      .toSorted((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || a.id.localeCompare(b.id))[0];
    return { ...project, latestAt: latest?.occurredAt, latestProgress: latest?.summary, fallbackAt: discoveryDates.get(project.id) };
  });
  const candidates = workbench.listCandidates().map(candidate => ({ ...candidate, latestAt: editDates.get(candidate.id) }));
  const persistedIntelligence = db.prepare(`SELECT id,subject_name,track,subtrack,city,signal_type,event_date,status,investment_summary,discovery_reason,created_at
    FROM intelligence_candidates
    WHERE entity_type='company' AND legacy_project_candidate_id IS NULL AND promoted_entity_id IS NULL AND status IN ('pending_review','dismissed')`).all()
    .map((row): IntelligenceCatalogCandidate => {
      const candidate = intelligenceRepository.get(String(row.id));
      return {
        id: String(row.id), name: candidate?.name ?? String(row.subject_name), track: candidate?.track ?? String(row.track), subtrack: candidate?.subtrack ?? String(row.subtrack ?? ""), city: candidate?.city ?? String(row.city ?? ""),
        signalType: candidate?.signalType ?? String(row.signal_type), eventDate: candidate?.eventDate ?? String(row.event_date), status: candidate?.status ?? row.status as IntelligenceCatalogCandidate["status"],
        summary: candidate?.investmentSummary || String(row.investment_summary || row.discovery_reason), createdAt: candidate?.createdAt ?? String(row.created_at), candidate,
      };
    });
  const intelligence = [...persistedIntelligence, ...localPreviewCandidates.map((candidate): IntelligenceCatalogCandidate => ({
    id: candidate.id, name: candidate.name, track: candidate.track, subtrack: candidate.subtrack ?? "", city: candidate.city ?? "",
    signalType: candidate.signalType, eventDate: candidate.eventDate, status: candidate.status, summary: candidate.investmentSummary,
    createdAt: candidate.createdAt, candidate,
  }))];
  return buildProjectCatalog(projects, candidates, intelligence);
}
