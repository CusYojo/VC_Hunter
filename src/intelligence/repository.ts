import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  candidateBundleEnvelopeSchema,
  companyDedupeKeys,
  computeCompleteness,
  defaultDiscoveryPlans,
  discoveryPlanUpdateSchema,
  intelligenceCandidateInputSchema,
  missingResearchFields,
  normalizeScores,
  personDedupeKeys,
  priorityForCandidate,
  technologyDedupeKeys,
  type CandidateScores,
  type CompletenessLevel,
  type EntityType,
  type IntelligenceCandidateInput,
  type PriorityBand,
} from "./contracts";
import { nextIntelligencePlanRun } from "./scheduling";

const MAX_BUNDLE_BYTES = 16 * 1024 * 1024;

interface ImportContext { tenantId: string; actorId: string; idempotencyKey: string; rawBytes: number; now: string }
interface CommitContext { tenantId: string; actorId: string; expectedVersion: number; now: string }
interface ReviewContext { actorId: string; idempotencyKey: string; now: string }
interface MatchSuggestion { entityType: EntityType; entityId: string; name: string; confidence: number; reason: string }
interface PreviewItem { index: number; externalId: string; name: string; completeness: CompletenessLevel; priority: PriorityBand; scores: CandidateScores; matches: MatchSuggestion[]; duplicateOf: string | null; candidateKind: "new_entity" | "entity_update" }
export interface ImportPreview { importId: string; version: number; total: number; valid: number; errors: Array<{ index: number; message: string }>; duplicates: Array<{ index: number; candidateId: string }>; items: PreviewItem[] }
export interface CandidateListFilters { entityType?: EntityType; channel?: string; city?: string; track?: string; priority?: PriorityBand; completeness?: CompletenessLevel; status?: "pending_review" | "promoted" | "dismissed" | "merged"; query?: string; dateFrom?: string; dateTo?: string; limit?: number; offset?: number }

interface CandidateRow {
  id: string; legacy_project_candidate_id: string | null; external_id: string | null; entity_type: EntityType; candidate_kind: "new_entity" | "entity_update";
  subject_name: string; track: string; subtrack: string | null; city: string | null; signal_type: string; event_date: string;
  source_channel: string; discovery_reason: string; investment_summary: string; investment_highlights_json: string; priority_band: PriorityBand;
  scores_json: string; completeness_level: CompletenessLevel; open_questions_json: string; missing_fields_json: string;
  matched_entity_type: EntityType | null; matched_entity_id: string | null; match_confidence: number | null; match_reason: string | null;
  status: "pending_review" | "promoted" | "dismissed" | "merged"; review_version: number; review_reason: string | null;
  promoted_entity_id: string | null; details_json: string; created_at: string; updated_at: string;
}

export interface IntelligenceCandidateView {
  id: string; legacyProjectCandidateId: string | null; externalId?: string | null; entityType: EntityType; candidateKind: "new_entity" | "entity_update";
  name: string; track: string; subtrack: string | null; city: string | null; signalType: string; eventDate: string; channel: string;
  discoveryReason: string; investmentSummary: string; investmentHighlights: string[]; priority: PriorityBand; scores: CandidateScores;
  completeness: CompletenessLevel; openQuestions: string[]; missingFields: string[]; matchedEntityType: EntityType | null;
  matchedEntityId: string | null; matchConfidence: number | null; matchReason: string | null; status: CandidateRow["status"];
  version: number; reviewReason: string | null; promotedEntityId: string | null; details: Record<string, unknown>; createdAt: string; updatedAt: string;
  evidence?: Array<Record<string, unknown>>; assertions?: Array<Record<string, unknown>>; relationships?: Array<Record<string, unknown>>; contacts?: Array<Record<string, unknown>>;
}

const reviewSchema = z.object({
  decision: z.enum(["promote", "reject", "merge"]),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(2).max(2_000),
  matchedEntityType: z.enum(["company", "person", "technology"]).optional(),
  matchedEntityId: z.string().trim().min(1).max(200).optional(),
}).strict();

export class IntelligenceDiscoveryError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "PAYLOAD_TOO_LARGE" | "IDEMPOTENCY_CONFLICT" | "NOT_FOUND" | "VERSION_CONFLICT" | "REVIEW_INVALID" | "CONNECTOR_NOT_READY", message: string) { super(message); }
}

export class IntelligenceDiscoveryRepository {
  constructor(private readonly database: DatabaseSync) {}

  backfillLegacyCandidates(now = new Date().toISOString()): { inserted: number; skipped: number } {
    const rows = this.database.prepare(`SELECT pc.*,w.url,w.title,w.published_at,w.first_seen_at
      FROM project_candidates pc JOIN web_search_leads w ON w.id=pc.lead_id
      WHERE NOT EXISTS(SELECT 1 FROM intelligence_candidates i WHERE i.legacy_project_candidate_id=pc.id)`).all() as Array<Record<string, unknown>>;
    const totalLegacy = (this.database.prepare("SELECT count(*) AS count FROM project_candidates").get() as { count: number }).count;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) this.insertLegacyCandidate(row, now);
      this.database.exec("COMMIT");
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
    return { inserted: rows.length, skipped: totalLegacy - rows.length };
  }

  previewImport(input: unknown, context: ImportContext): ImportPreview {
    requireContext(context.tenantId, context.actorId, context.idempotencyKey);
    if (!Number.isInteger(context.rawBytes) || context.rawBytes < 1) throw new IntelligenceDiscoveryError("INVALID_INPUT", "数据包大小无效。");
    if (context.rawBytes > MAX_BUNDLE_BYTES) throw new IntelligenceDiscoveryError("PAYLOAD_TOO_LARGE", "数据包不能超过 16 MB。");
    this.database.prepare("DELETE FROM discovery_import_batches WHERE status='previewed' AND expires_at IS NOT NULL AND expires_at<=?").run(context.now);
    const parsed = candidateBundleEnvelopeSchema.safeParse(input);
    if (!parsed.success) throw new IntelligenceDiscoveryError("INVALID_INPUT", "数据包结构无效：" + parsed.error.issues[0]?.message);
    const payloadHash = hash(JSON.stringify(parsed.data));
    const existing = this.database.prepare("SELECT payload_hash,preview_json FROM discovery_import_batches WHERE tenant_id=? AND actor_id=? AND idempotency_key=?").get(context.tenantId, context.actorId, context.idempotencyKey) as { payload_hash: string; preview_json: string } | undefined;
    if (existing) {
      if (existing.payload_hash !== payloadHash) throw new IntelligenceDiscoveryError("IDEMPOTENCY_CONFLICT", "幂等键已用于不同数据包。");
      return JSON.parse(existing.preview_json) as ImportPreview;
    }

    const validated = parsed.data.items.map((item, index) => ({ index, result: intelligenceCandidateInputSchema.safeParse(item) }));
    const errors = validated.flatMap(({ index, result }) => {
      if (!result.success) return [{ index, message: result.error.issues.map((issue) => `${issue.path.join(".") || "record"}: ${issue.message}`).join("；") }];
      return batchAllowsCandidate(parsed.data.batch.accessClass, result.data) ? [] : [{ index, message: "batch.accessClass: 批次访问级别不能低于记录内资料的访问级别。" }];
    });
    const importId = randomUUID();
    const seen = new Map<string, number>();
    const seenSemantic = new Map<string, number>();
    const items = validated.flatMap(({ index, result }): PreviewItem[] => {
      if (!result.success || !batchAllowsCandidate(parsed.data.batch.accessClass, result.data)) return [];
      const item = result.data;
      const contentHash = candidateContentHash(item);
      const withinBatch = seen.get(contentHash);
      seen.set(contentHash, index);
      const stored = this.database.prepare("SELECT id FROM intelligence_candidates WHERE content_hash=? LIMIT 1").get(contentHash) as { id: string } | undefined;
      const semanticKey = semanticCandidateKey(item);
      const semanticWithinBatch = seenSemantic.get(semanticKey);
      seenSemantic.set(semanticKey, index);
      const semanticStored = stored ? undefined : this.findSemanticDuplicate(item);
      const matches = this.findMatches(item);
      const scores = normalizedCandidateScores(item);
      const completeness = computeCompleteness(item);
      return [{
        index, externalId: item.externalId, name: item.name, completeness, scores,
        priority: priorityForCandidate(completeness, scores, item.investmentHighlights.length > 0), matches,
        duplicateOf: stored?.id ?? semanticStored?.id ?? (withinBatch === undefined ? (semanticWithinBatch === undefined ? null : `batch-index:${semanticWithinBatch}`) : `batch-index:${withinBatch}`),
        candidateKind: matches.length > 0 ? "entity_update" : item.candidateKind,
      }];
    });
    const preview: ImportPreview = {
      importId, version: 1, total: parsed.data.items.length, valid: items.length,
      errors, duplicates: items.flatMap((item) => item.duplicateOf ? [{ index: item.index, candidateId: item.duplicateOf }] : []), items,
    };
    const normalizedPayload = JSON.stringify({
      ...parsed.data,
      items: validated.map(({ result }) => result.success && batchAllowsCandidate(parsed.data.batch.accessClass, result.data) ? result.data : null),
    });
    this.database.prepare(`INSERT INTO discovery_import_batches(
      id,tenant_id,actor_id,idempotency_key,schema_version,source_batch_id,payload_hash,payload_bytes,original_json,preview_json,status,version,created_at,expires_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(importId, context.tenantId, context.actorId, context.idempotencyKey, parsed.data.schemaVersion, parsed.data.batch.id, payloadHash, context.rawBytes, normalizedPayload, JSON.stringify(preview), "previewed", 1, context.now, new Date(Date.parse(context.now) + 86_400_000).toISOString());
    return preview;
  }

  commitImport(importId: string, context: CommitContext): { importId: string; inserted: number; skipped: number; candidateIds: string[] } {
    this.database.prepare("DELETE FROM discovery_import_batches WHERE status='previewed' AND expires_at IS NOT NULL AND expires_at<=?").run(context.now);
    const row = this.database.prepare("SELECT * FROM discovery_import_batches WHERE id=? AND tenant_id=?").get(importId, context.tenantId) as Record<string, unknown> | undefined;
    if (!row) throw new IntelligenceDiscoveryError("NOT_FOUND", "导入批次不存在。");
    if (row.actor_id !== context.actorId) throw new IntelligenceDiscoveryError("NOT_FOUND", "导入批次不存在。");
    if (row.status === "committed") return JSON.parse(String(row.commit_result_json)) as { importId: string; inserted: number; skipped: number; candidateIds: string[] };
    if (Number(row.version) !== context.expectedVersion) throw new IntelligenceDiscoveryError("VERSION_CONFLICT", "导入预检结果已更新，请重新预检。");
    const bundle = candidateBundleEnvelopeSchema.parse(JSON.parse(String(row.original_json)));
    const preview = JSON.parse(String(row.preview_json)) as ImportPreview;
    const candidateIds: string[] = [];
    let skipped = 0;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const itemPreview of preview.items) {
        if (itemPreview.duplicateOf) { skipped += 1; continue; }
        const item = intelligenceCandidateInputSchema.parse(bundle.items[itemPreview.index]);
        const candidateId = randomUUID();
        const primaryMatch = itemPreview.matches[0];
        this.insertCandidate(candidateId, importId, item, itemPreview, primaryMatch, context.now);
        candidateIds.push(candidateId);
      }
      const result = { importId, inserted: candidateIds.length, skipped, candidateIds };
      const updated = this.database.prepare("UPDATE discovery_import_batches SET status='committed',version=version+1,commit_result_json=?,committed_at=? WHERE id=? AND version=?")
        .run(JSON.stringify(result), context.now, importId, context.expectedVersion);
      if (Number(updated.changes) !== 1) throw new IntelligenceDiscoveryError("VERSION_CONFLICT", "导入预检结果已更新，请重新预检。");
      this.database.exec("COMMIT");
      return result;
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  create(input: unknown, context: ReviewContext): IntelligenceCandidateView {
    requireContext("organization", context.actorId, context.idempotencyKey);
    const item = intelligenceCandidateInputSchema.parse(input);
    const requestPayload = JSON.stringify(item);
    const prior = this.findWriteRequest(context.actorId, context.idempotencyKey, "intelligence.create", requestPayload);
    if (prior) {
      const candidate = this.get(prior.resourceId);
      if (!candidate) throw new IntelligenceDiscoveryError("NOT_FOUND", "原候选记录已不存在。");
      return candidate;
    }
    const duplicate = (this.database.prepare("SELECT id FROM intelligence_candidates WHERE content_hash=? LIMIT 1").get(candidateContentHash(item)) as { id: string } | undefined)
      ?? this.findSemanticDuplicate(item);
    if (duplicate) {
      this.database.exec("BEGIN IMMEDIATE");
      try {
        this.recordWriteRequest(context.actorId, context.idempotencyKey, "intelligence.create", duplicate.id, requestPayload, context.now);
        this.database.exec("COMMIT");
      } catch (error) { this.database.exec("ROLLBACK"); throw error; }
      return this.get(duplicate.id)!;
    }
    const matches = this.findMatches(item);
    const scores = normalizedCandidateScores(item);
    const completeness = computeCompleteness(item);
    const preview: PreviewItem = { index: 0, externalId: item.externalId, name: item.name, completeness, scores, priority: priorityForCandidate(completeness, scores, item.investmentHighlights.length > 0), matches, duplicateOf: null, candidateKind: matches.length ? "entity_update" : item.candidateKind };
    const id = randomUUID();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.insertCandidate(id, null, item, preview, matches[0], context.now);
      this.recordWriteRequest(context.actorId, context.idempotencyKey, "intelligence.create", id, requestPayload, context.now);
      this.database.exec("COMMIT");
    }
    catch (error) { this.database.exec("ROLLBACK"); throw error; }
    return this.get(id)!;
  }

  list(filters: CandidateListFilters): { items: IntelligenceCandidateView[]; total: number } {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    for (const [column, value] of [["entity_type", filters.entityType], ["source_channel", filters.channel], ["city", filters.city], ["track", filters.track], ["priority_band", filters.priority], ["completeness_level", filters.completeness], ["status", filters.status]] as const) {
      if (value) { clauses.push(`${column}=?`); params.push(value); }
    }
    if (filters.query?.trim()) { clauses.push("(subject_name LIKE ? OR discovery_reason LIKE ? OR investment_summary LIKE ?)"); const value = `%${escapeLike(filters.query.trim())}%`; params.push(value, value, value); }
    if (filters.dateFrom) { clauses.push("event_date>=?"); params.push(filters.dateFrom); }
    if (filters.dateTo) { clauses.push("event_date<=?"); params.push(filters.dateTo); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const total = (this.database.prepare(`SELECT count(*) AS count FROM intelligence_candidates ${where}`).get(...params) as { count: number }).count;
    const limit = Math.min(200, Math.max(1, filters.limit ?? 100));
    const offset = Math.max(0, filters.offset ?? 0);
    const rows = this.database.prepare(`SELECT * FROM intelligence_candidates ${where} ORDER BY CASE priority_band WHEN 'A' THEN 0 WHEN 'B' THEN 1 ELSE 2 END,event_date DESC,created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as unknown as CandidateRow[];
    return { items: rows.map(mapCandidate), total };
  }

  get(id: string): IntelligenceCandidateView | undefined {
    const row = this.database.prepare("SELECT * FROM intelligence_candidates WHERE id=?").get(id) as unknown as CandidateRow | undefined;
    if (!row) return undefined;
    return {
      ...mapCandidate(row),
      evidence: (this.database.prepare("SELECT id,source_ref AS ref,title,url,published_at AS publishedAt,observed_at AS observedAt,excerpt,authority,access_class AS accessClass,collection_method AS collectionMethod,allow_external_model AS allowExternalModel FROM intelligence_candidate_sources WHERE candidate_id=? ORDER BY authority,observed_at DESC").all(id) as Array<Record<string, unknown>>).map((evidence) => ({ ...evidence, allowExternalModel: Boolean(evidence.allowExternalModel) })),
      assertions: this.database.prepare("SELECT id,field_key AS field,label,value_status AS valueStatus,epistemic_type AS epistemicType,value_json AS value,unit,confidence,evidence_refs_json AS evidenceRefs FROM intelligence_candidate_assertions WHERE candidate_id=? ORDER BY field_key").all(id).map((value) => parseAliasedJson(value as Record<string, unknown>, ["value", "evidenceRefs"])),
      relationships: this.database.prepare("SELECT id,related_entity_type AS entityType,related_entity_id AS entityId,related_name AS name,relation_type AS relation,confidence,evidence_refs_json AS evidenceRefs FROM intelligence_candidate_relationships WHERE candidate_id=?").all(id).map((value) => parseAliasedJson(value as Record<string, unknown>, ["evidenceRefs"])),
      contacts: this.database.prepare("SELECT id,contact_type AS type,contact_value AS value,source_ref AS sourceRef,verified_at AS verifiedAt FROM intelligence_candidate_contacts WHERE candidate_id=?").all(id).map((contact) => ({ ...contact })),
    };
  }

  private findSemanticDuplicate(item: IntelligenceCandidateInput): { id: string } | undefined {
    const rows = this.database.prepare(`SELECT i.id,i.subject_name,i.city,i.details_json,GROUP_CONCAT(DISTINCT s.access_class) AS access_classes
      FROM intelligence_candidates i LEFT JOIN intelligence_candidate_sources s ON s.candidate_id=i.id
      WHERE i.entity_type=? AND i.signal_type=? AND i.event_date=? GROUP BY i.id`).all(item.entityType, item.signalType, item.eventDate) as Array<{ id: string; subject_name: string; city: string | null; details_json: string; access_classes: string | null }>;
    return rows.find((row) => sameCandidateEntity(item, row));
  }

  update(id: string, input: unknown, context: ReviewContext): IntelligenceCandidateView {
    requireContext("organization", context.actorId, context.idempotencyKey);
    const schema = z.object({ investmentSummary: z.string().trim().max(1_000).optional(), investmentHighlights: z.array(z.string().trim().min(1).max(500)).max(20).optional(), openQuestions: z.array(z.string().trim().min(1).max(500)).max(50).optional(), priority: z.enum(["A", "B", "C"]).optional(), expectedVersion: z.number().int().positive() }).strict();
    const parsed = schema.parse(input);
    const requestPayload = JSON.stringify({ id, ...parsed });
    const prior = this.findWriteRequest(context.actorId, context.idempotencyKey, "intelligence.update", requestPayload);
    if (prior) {
      const candidate = this.get(prior.resourceId);
      if (!candidate) throw new IntelligenceDiscoveryError("NOT_FOUND", "原候选记录已不存在。");
      return candidate;
    }
    const current = this.get(id);
    if (!current) throw new IntelligenceDiscoveryError("NOT_FOUND", "情报候选不存在。");
    if (current.version !== parsed.expectedVersion) throw new IntelligenceDiscoveryError("VERSION_CONFLICT", "候选已更新，请刷新后重试。");
    if (current.status !== "pending_review") throw new IntelligenceDiscoveryError("REVIEW_INVALID", "只有待审候选可以编辑。");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const updated = this.database.prepare(`UPDATE intelligence_candidates SET investment_summary=?,investment_highlights_json=?,open_questions_json=?,priority_band=?,review_version=review_version+1,updated_at=? WHERE id=? AND review_version=?`)
        .run(parsed.investmentSummary ?? current.investmentSummary, JSON.stringify(parsed.investmentHighlights ?? current.investmentHighlights), JSON.stringify(parsed.openQuestions ?? current.openQuestions), parsed.priority ?? current.priority, context.now, id, parsed.expectedVersion);
      if (Number(updated.changes) !== 1) throw new IntelligenceDiscoveryError("VERSION_CONFLICT", "候选已更新，请刷新后重试。");
      this.recordWriteRequest(context.actorId, context.idempotencyKey, "intelligence.update", id, requestPayload, context.now);
      this.database.exec("COMMIT");
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
    return this.get(id)!;
  }

  review(id: string, input: unknown, context: ReviewContext): IntelligenceCandidateView {
    requireContext("organization", context.actorId, context.idempotencyKey);
    const parsed = reviewSchema.parse(input);
    const requestHash = hash(JSON.stringify({ id, ...parsed }));
    const repeat = this.database.prepare("SELECT request_hash,result_json FROM discovery_review_requests WHERE actor_id=? AND idempotency_key=?").get(context.actorId, context.idempotencyKey) as { request_hash: string; result_json: string } | undefined;
    if (repeat) {
      if (repeat.request_hash !== requestHash) throw new IntelligenceDiscoveryError("IDEMPOTENCY_CONFLICT", "幂等键已用于不同审核请求。");
      return JSON.parse(repeat.result_json) as IntelligenceCandidateView;
    }
    const current = this.get(id);
    if (!current) throw new IntelligenceDiscoveryError("NOT_FOUND", "情报候选不存在。");
    if (current.version !== parsed.expectedVersion) throw new IntelligenceDiscoveryError("VERSION_CONFLICT", "候选已更新，请刷新后重试。");
    if (current.status !== "pending_review") throw new IntelligenceDiscoveryError("REVIEW_INVALID", "候选已完成审核。");
    if (parsed.decision !== "reject" && current.completeness === "L0") throw new IntelligenceDiscoveryError("REVIEW_INVALID", "候选至少达到 L1 才能入库或合并。");
    const match = parsed.matchedEntityId ? { entityType: parsed.matchedEntityType ?? current.entityType, entityId: parsed.matchedEntityId } : current.matchedEntityId ? { entityType: current.matchedEntityType ?? current.entityType, entityId: current.matchedEntityId } : null;
    if (parsed.decision === "merge" && !match) throw new IntelligenceDiscoveryError("REVIEW_INVALID", "合并审核必须指定已有实体。");
    if (match && !this.entityExists(match.entityType, match.entityId)) throw new IntelligenceDiscoveryError("REVIEW_INVALID", "指定的已有实体不存在或已失效。");

    this.database.exec("BEGIN IMMEDIATE");
    try {
      let promotedEntityId: string | null = null;
      if (parsed.decision === "promote" || parsed.decision === "merge") promotedEntityId = this.promote(current, match, context);
      const status = parsed.decision === "reject" ? "dismissed" : parsed.decision === "merge" ? "merged" : "promoted";
      const updated = this.database.prepare(`UPDATE intelligence_candidates SET status=?,review_version=review_version+1,reviewed_by=?,reviewed_at=?,review_reason=?,promoted_entity_id=?,updated_at=? WHERE id=? AND review_version=?`)
        .run(status, context.actorId, context.now, parsed.reason, promotedEntityId ?? match?.entityId ?? null, context.now, id, parsed.expectedVersion);
      if (Number(updated.changes) !== 1) throw new IntelligenceDiscoveryError("VERSION_CONFLICT", "候选已更新，请刷新后重试。");
      const result = this.get(id)!;
      this.database.prepare("INSERT INTO discovery_review_requests(id,candidate_id,actor_id,idempotency_key,request_hash,result_json,created_at) VALUES(?,?,?,?,?,?,?)")
        .run(randomUUID(), id, context.actorId, context.idempotencyKey, requestHash, JSON.stringify(result), context.now);
      this.database.prepare("INSERT INTO audit_log(id,actor,action,resource_type,resource_id,before_json,after_json,note,request_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
        .run(randomUUID(), context.actorId, `intelligence.${parsed.decision}`, "intelligence_candidate", id, JSON.stringify(current), JSON.stringify(result), parsed.reason, context.idempotencyKey, context.now);
      this.database.exec("COMMIT");
      return result;
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  listTechnologies(filters: { query?: string; track?: string; limit?: number; offset?: number }): { items: Array<Record<string, unknown>>; total: number } {
    const clauses: string[] = []; const params: Array<string | number> = [];
    if (filters.query?.trim()) { clauses.push("(name LIKE ? OR definition LIKE ?)"); const value = `%${escapeLike(filters.query.trim())}%`; params.push(value, value); }
    if (filters.track) { clauses.push("track=?"); params.push(filters.track); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const total = (this.database.prepare(`SELECT count(*) AS count FROM technologies ${where}`).get(...params) as { count: number }).count;
    const rows = this.database.prepare(`SELECT * FROM technologies ${where} ORDER BY updated_at DESC,name LIMIT ? OFFSET ?`).all(...params, Math.min(200, Math.max(1, filters.limit ?? 100)), Math.max(0, filters.offset ?? 0)) as Array<Record<string, unknown>>;
    return { items: rows.map(mapTechnology), total };
  }

  getTechnology(id: string): Record<string, unknown> | undefined {
    const row = this.database.prepare("SELECT * FROM technologies WHERE id=?").get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const assertions = this.database.prepare("SELECT * FROM entity_assertions WHERE entity_type='technology' AND entity_id=? ORDER BY created_at DESC").all(id);
    const events = this.database.prepare("SELECT * FROM entity_intelligence_events WHERE entity_type='technology' AND entity_id=? ORDER BY occurred_at DESC").all(id);
    const relationships = this.database.prepare("SELECT * FROM entity_relationships WHERE source_entity_type='technology' AND source_entity_id=? ORDER BY relation_type,target_name").all(id);
    return { ...mapTechnology(row), assertions, relationships, events };
  }

  listPlans(now = new Date().toISOString()): Array<Record<string, unknown>> {
    this.ensureDefaultPlans(now);
    return (this.database.prepare("SELECT * FROM discovery_plans_v2 ORDER BY CASE channel WHEN 'venture_tech' THEN 0 WHEN 'registry' THEN 1 WHEN 'hiring' THEN 2 ELSE 3 END").all() as Array<Record<string, unknown>>)
      .map((row) => mapPlan(row, this.connectorReady(row)));
  }

  updatePlan(id: string, input: unknown, context: ReviewContext): Record<string, unknown> {
    requireContext("organization", context.actorId, context.idempotencyKey);
    const parsed = discoveryPlanUpdateSchema.parse(input);
    const requestPayload = JSON.stringify({ id, ...parsed });
    const prior = this.findWriteRequest(context.actorId, context.idempotencyKey, "intelligence.plan.update", requestPayload);
    if (prior) {
      const repeated = this.database.prepare("SELECT * FROM discovery_plans_v2 WHERE id=?").get(prior.resourceId) as Record<string, unknown> | undefined;
      if (!repeated) throw new IntelligenceDiscoveryError("NOT_FOUND", "原监测计划已不存在。");
      return mapPlan(repeated, this.connectorReady(repeated));
    }
    this.ensureDefaultPlans(context.now);
    const current = this.database.prepare("SELECT * FROM discovery_plans_v2 WHERE id=?").get(id) as Record<string, unknown> | undefined;
    if (!current) throw new IntelligenceDiscoveryError("NOT_FOUND", "发现计划不存在。");
    if (Number(current.version) !== parsed.expectedVersion) throw new IntelligenceDiscoveryError("VERSION_CONFLICT", "发现计划已更新，请刷新后重试。");
    const enabled = parsed.enabled ?? Boolean(current.enabled);
    if (enabled && !this.connectorReady(current)) {
      throw new IntelligenceDiscoveryError("CONNECTOR_NOT_READY", "该渠道需要正式数据授权和凭据配置，采购接通前不能启用。");
    }
    const schedule = parsed.schedule ?? JSON.parse(String(current.schedule_json));
    const wasEnabled = Boolean(current.enabled);
    const nextRunAt = enabled && (parsed.schedule || !wasEnabled || !current.next_run_at) ? nextIntelligencePlanRun(schedule, context.now) : nullableString(current.next_run_at);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const updated = this.database.prepare(`UPDATE discovery_plans_v2 SET enabled=?,query_family=?,tracks_json=?,subtracks_json=?,cities_json=?,preferred_domains_json=?,date_window_days=?,schedule_json=?,next_run_at=?,version=version+1,updated_by=?,updated_at=? WHERE id=? AND version=?`)
        .run(Number(enabled), parsed.queryFamily ?? String(current.query_family), JSON.stringify(parsed.tracks ?? JSON.parse(String(current.tracks_json))), JSON.stringify(parsed.subtracks ?? JSON.parse(String(current.subtracks_json))), JSON.stringify(parsed.cities ?? JSON.parse(String(current.cities_json))), JSON.stringify(parsed.preferredDomains ?? JSON.parse(String(current.preferred_domains_json))), parsed.dateWindowDays ?? Number(current.date_window_days), JSON.stringify(schedule), nextRunAt, context.actorId, context.now, id, parsed.expectedVersion);
      if (Number(updated.changes) !== 1) throw new IntelligenceDiscoveryError("VERSION_CONFLICT", "发现计划已更新，请刷新后重试。");
      this.recordWriteRequest(context.actorId, context.idempotencyKey, "intelligence.plan.update", id, requestPayload, context.now);
      this.database.exec("COMMIT");
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
    const updated = this.database.prepare("SELECT * FROM discovery_plans_v2 WHERE id=?").get(id) as Record<string, unknown>;
    return mapPlan(updated, this.connectorReady(updated));
  }

  private connectorReady(plan: Record<string, unknown>): boolean {
    // First release contains contract-tested licensed adapters only. Credentials
    // cannot make an unimplemented runtime connector appear executable.
    return String(plan.connector_type) !== "licensed_api";
  }

  private ensureDefaultPlans(now: string): void {
    const insert = this.database.prepare(`INSERT OR IGNORE INTO discovery_plans_v2(id,name,channel,query_family,tracks_json,subtracks_json,cities_json,preferred_domains_json,date_window_days,connector_type,enabled,schedule_json,next_run_at,version,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const plan of defaultDiscoveryPlans) insert.run(plan.id, plan.name, plan.channel, plan.queryFamily, JSON.stringify(plan.tracks), JSON.stringify(plan.subtracks), JSON.stringify(plan.cities), JSON.stringify(plan.preferredDomains), plan.dateWindowDays, plan.connectorType, Number(plan.enabled), JSON.stringify(plan.schedule), nextIntelligencePlanRun(plan.schedule, now), 1, now, now);
  }

  private insertLegacyCandidate(row: Record<string, unknown>, now: string): void {
    const id = String(row.id);
    const promotedEntity = row.promoted_project_id ? this.database.prepare("SELECT company_id FROM projects WHERE id=?").get(String(row.promoted_project_id)) as { company_id: string } | undefined : undefined;
    this.database.prepare(`INSERT INTO intelligence_candidates(id,legacy_project_candidate_id,entity_type,candidate_kind,subject_name,track,signal_type,event_date,source_channel,discovery_reason,investment_summary,investment_highlights_json,priority_band,scores_json,completeness_level,open_questions_json,missing_fields_json,status,review_version,reviewed_by,reviewed_at,review_reason,promoted_entity_id,details_json,content_hash,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, id, "company", "new_entity", String(row.company_name), String(row.track), String(row.signal_type), String(row.published_at ?? row.created_at).slice(0, 10), "venture_tech", String(row.summary), String(row.summary), "[]", "C", JSON.stringify({ technology: 1, team: 1, commercial: 1, signal: 1, evidence: 1 }), "L0", "[]", "[]", String(row.status), Number(row.review_version ?? 1), nullableString(row.reviewed_by), nullableString(row.reviewed_at), nullableString(row.review_reason), promotedEntity?.company_id ?? null, "{}", `legacy:${id}`, String(row.created_at ?? now), String(row.updated_at ?? now));
    if (row.url) this.database.prepare(`INSERT INTO intelligence_candidate_sources(id,candidate_id,source_ref,title,url,published_at,observed_at,excerpt,authority,access_class,collection_method,allow_external_model,content_hash)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), id, "legacy-lead", String(row.title ?? row.company_name), String(row.url), nullableString(row.published_at), String(row.first_seen_at ?? now), String(row.summary), "C", "public", "legacy", 0, hash(String(row.url) + String(row.summary)));
  }

  private insertCandidate(id: string, batchId: string | null, item: IntelligenceCandidateInput, preview: PreviewItem, match: MatchSuggestion | undefined, now: string): void {
    const details = { ...(item.company ? { company: item.company } : {}), ...(item.person ? { person: item.person } : {}), ...(item.technology ? { technology: item.technology } : {}) };
    this.database.prepare(`INSERT INTO intelligence_candidates(id,import_batch_id,external_id,entity_type,candidate_kind,subject_name,track,subtrack,city,signal_type,event_date,source_channel,discovery_reason,investment_summary,investment_highlights_json,priority_band,scores_json,completeness_level,open_questions_json,missing_fields_json,matched_entity_type,matched_entity_id,match_confidence,match_reason,status,review_version,details_json,content_hash,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, batchId, item.externalId, item.entityType, preview.candidateKind, item.name, item.track, item.subtrack ?? null, item.city ?? null, item.signalType, item.eventDate, item.channel, item.discoveryReason, item.investmentSummary, JSON.stringify(item.investmentHighlights), preview.priority, JSON.stringify(preview.scores), preview.completeness, JSON.stringify(item.openQuestions), JSON.stringify(missingResearchFields(item)), match?.entityType ?? null, match?.entityId ?? null, match?.confidence ?? null, match?.reason ?? null, "pending_review", 1, JSON.stringify(details), candidateContentHash(item), now, now);
    const insertSource = this.database.prepare(`INSERT INTO intelligence_candidate_sources(id,candidate_id,source_ref,title,url,published_at,observed_at,excerpt,authority,access_class,collection_method,allow_external_model,content_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const evidence of item.evidence) insertSource.run(randomUUID(), id, evidence.ref, evidence.title, evidence.url, evidence.publishedAt ?? null, evidence.observedAt, evidence.excerpt, evidence.authority, evidence.accessClass, evidence.collectionMethod, Number(evidence.allowExternalModel), hash(`${evidence.url}\n${evidence.excerpt}`));
    const insertAssertion = this.database.prepare(`INSERT INTO intelligence_candidate_assertions(id,candidate_id,field_key,label,value_status,epistemic_type,value_json,unit,confidence,evidence_refs_json) VALUES(?,?,?,?,?,?,?,?,?,?)`);
    for (const assertion of item.assertions) insertAssertion.run(randomUUID(), id, assertion.field, assertion.label, assertion.valueStatus, assertion.epistemicType, assertion.value === undefined ? null : JSON.stringify(assertion.value), assertion.unit ?? null, assertion.confidence, JSON.stringify(assertion.evidenceRefs));
    const insertRelationship = this.database.prepare(`INSERT INTO intelligence_candidate_relationships(id,candidate_id,related_entity_type,related_entity_id,related_name,relation_type,confidence,evidence_refs_json) VALUES(?,?,?,?,?,?,?,?)`);
    for (const relationship of item.relationships) insertRelationship.run(randomUUID(), id, relationship.entityType, relationship.entityId ?? null, relationship.name, relationship.relation, relationship.confidence, JSON.stringify(relationship.evidenceRefs));
    const insertContact = this.database.prepare("INSERT INTO intelligence_candidate_contacts(id,candidate_id,contact_type,contact_value,source_ref,verified_at) VALUES(?,?,?,?,?,?)");
    for (const contact of item.contacts) insertContact.run(randomUUID(), id, contact.type, contact.value, contact.sourceRef, contact.verifiedAt);
  }

  private findMatches(item: IntelligenceCandidateInput): MatchSuggestion[] {
    if (item.entityType === "company") return this.findCompanyMatches(item);
    if (item.entityType === "person") return this.findPersonMatches(item);
    return this.findTechnologyMatches(item);
  }

  private findCompanyMatches(item: IntelligenceCandidateInput): MatchSuggestion[] {
    const keys = companyDedupeKeys({ name: item.name, city: item.city, unifiedCreditCode: item.company?.unifiedCreditCode, officialWebsite: item.company?.officialWebsite });
    const rows = this.database.prepare("SELECT id,legal_name,official_domain,region_scope,unified_credit_code FROM companies").all() as Array<{ id: string; legal_name: string; official_domain: string | null; region_scope: string; unified_credit_code: string | null }>;
    return bestMatches(rows.flatMap((row) => {
      const rowKeys = companyDedupeKeys({ name: row.legal_name, city: row.region_scope, unifiedCreditCode: row.unified_credit_code ?? undefined, officialWebsite: row.official_domain ? `https://${row.official_domain}` : undefined });
      const common = keys.find((key) => rowKeys.includes(key));
      if (!common) return [];
      return [{ entityType: "company" as const, entityId: row.id, name: row.legal_name, confidence: common.startsWith("credit:") ? 1 : common.startsWith("domain:") ? 0.98 : 0.84, reason: common.startsWith("credit:") ? "统一社会信用代码一致" : common.startsWith("domain:") ? "官网域名一致" : "公司名称与城市一致" }];
    }));
  }

  private findPersonMatches(item: IntelligenceCandidateInput): MatchSuggestion[] {
    const keys = personDedupeKeys({ name: item.name, organization: item.person?.organization, education: item.person?.education, homepage: item.person?.homepage });
    const rows = this.database.prepare("SELECT p.id,p.name,p.current_organization,d.education_json,d.homepage FROM people p LEFT JOIN person_profile_details d ON d.person_id=p.id").all() as Array<{ id: string; name: string; current_organization: string | null; education_json: string | null; homepage: string | null }>;
    return bestMatches(rows.flatMap((row) => {
      const rowKeys = personDedupeKeys({ name: row.name, organization: row.current_organization ?? undefined, education: row.education_json ? JSON.parse(row.education_json) as string[] : [], homepage: row.homepage ?? undefined });
      const common = keys.find((key) => rowKeys.includes(key));
      return common ? [{ entityType: "person" as const, entityId: row.id, name: row.name, confidence: common.startsWith("homepage:") ? 0.98 : 0.86, reason: common.startsWith("homepage:") ? "个人主页一致" : "姓名及机构/教育背景一致" }] : [];
    }));
  }

  private findTechnologyMatches(item: IntelligenceCandidateInput): MatchSuggestion[] {
    const keys = technologyDedupeKeys({ name: item.technology?.normalizedName ?? item.name, identifiers: [...(item.technology?.papers ?? []), ...(item.technology?.patents ?? [])], topics: [item.subtrack ?? item.track] });
    const rows = this.database.prepare("SELECT id,name,normalized_name,papers_json,patents_json,subtrack,track FROM technologies").all() as Array<{ id: string; name: string; normalized_name: string; papers_json: string; patents_json: string; subtrack: string | null; track: string }>;
    return bestMatches(rows.flatMap((row) => {
      const rowKeys = technologyDedupeKeys({ name: row.normalized_name, identifiers: [...JSON.parse(row.papers_json) as string[], ...JSON.parse(row.patents_json) as string[]], topics: [row.subtrack ?? row.track] });
      const common = keys.find((key) => rowKeys.includes(key) && !key.startsWith("topic:"));
      return common ? [{ entityType: "technology" as const, entityId: row.id, name: row.name, confidence: common.startsWith("identifier:") ? 1 : 0.95, reason: common.startsWith("identifier:") ? "论文或专利标识一致" : "技术规范名称一致" }] : [];
    }));
  }

  private promote(candidate: IntelligenceCandidateView, match: { entityType: EntityType; entityId: string } | null, context: ReviewContext): string {
    const entityId = match?.entityId ?? randomUUID();
    if (match && match.entityType !== candidate.entityType) throw new IntelligenceDiscoveryError("REVIEW_INVALID", "匹配实体类型与候选类型不一致。");
    const evidenceByRef = this.materializeEvidence(candidate.id, candidate.channel, context.now);
    if (candidate.entityType === "company") this.promoteCompany(candidate, entityId, Boolean(match), evidenceByRef, context.now);
    else if (candidate.entityType === "person") this.promotePerson(candidate, entityId, Boolean(match), context.now);
    else this.promoteTechnology(candidate, entityId, Boolean(match), context.now);
    this.materializeEntityAssertions(candidate, entityId, evidenceByRef, context.now);
    this.materializeEntityRelationships(candidate, entityId, evidenceByRef, context.now);
    this.materializeContacts(candidate, entityId, evidenceByRef, context.actorId, context.now);
    this.database.prepare("INSERT INTO entity_intelligence_events(id,entity_type,entity_id,candidate_id,signal_type,occurred_at,summary,evidence_ids_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(randomUUID(), candidate.entityType, entityId, candidate.id, candidate.signalType, candidate.eventDate, candidate.discoveryReason, JSON.stringify([...evidenceByRef.values()]), context.now);
    for (const field of candidate.missingFields) this.database.prepare("INSERT OR IGNORE INTO intelligence_research_tasks(id,candidate_id,entity_type,entity_id,field_key,status,created_at) VALUES(?,?,?,?,?,'open',?)").run(randomUUID(), candidate.id, candidate.entityType, entityId, field, context.now);
    return entityId;
  }

  private promoteCompany(candidate: IntelligenceCandidateView, companyId: string, exists: boolean, evidenceByRef: Map<string, string>, now: string): void {
    const details = evidenceBackedDetails((candidate.details.company ?? {}) as Record<string, unknown>, this.candidateAssertions(candidate.id), {
      legalName: ["legalName", "subjectIdentity"], unifiedCreditCode: ["unifiedCreditCode"], incorporationDate: ["incorporationDate"], officialWebsite: ["officialWebsite"],
      registeredAddress: ["registeredAddress"], researchLocations: ["researchLocations"], businessScope: ["businessScope"], products: ["products"], coreTechnologies: ["coreTechnology", "coreTechnologies"], competitors: ["competitors"],
    }, ["fundingHistory", "mergersAndAcquisitions"]);
    const website = typeof details.officialWebsite === "string" ? new URL(details.officialWebsite).hostname.replace(/^www\./u, "") : null;
    if (!exists) this.database.prepare("INSERT INTO companies(id,legal_name,aliases_json,official_domain,region_scope,unified_credit_code,registration_status,incorporation_date) VALUES(?,?,?,?,?,?,?,?)")
      .run(companyId, stringOr(details.legalName, candidate.name), JSON.stringify([candidate.name]), website, candidate.city ?? "全国", nullableString(details.unifiedCreditCode), "待核验", nullableString(details.incorporationDate));
    else this.database.prepare("UPDATE companies SET official_domain=COALESCE(official_domain,?),unified_credit_code=COALESCE(unified_credit_code,?),incorporation_date=COALESCE(incorporation_date,?) WHERE id=?").run(website, nullableString(details.unifiedCreditCode), nullableString(details.incorporationDate), companyId);
    this.database.prepare(`INSERT INTO company_profiles(company_id,registered_address,research_locations_json,business_scope,products_json,core_technologies_json,competitors_json,updated_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(company_id) DO UPDATE SET registered_address=COALESCE(excluded.registered_address,registered_address),research_locations_json=CASE WHEN excluded.research_locations_json='[]' THEN research_locations_json ELSE excluded.research_locations_json END,business_scope=COALESCE(excluded.business_scope,business_scope),products_json=CASE WHEN excluded.products_json='[]' THEN products_json ELSE excluded.products_json END,core_technologies_json=CASE WHEN excluded.core_technologies_json='[]' THEN core_technologies_json ELSE excluded.core_technologies_json END,competitors_json=CASE WHEN excluded.competitors_json='[]' THEN competitors_json ELSE excluded.competitors_json END,updated_at=excluded.updated_at`)
      .run(companyId, nullableString(details.registeredAddress), jsonArray(details.researchLocations), nullableString(details.businessScope), jsonArray(details.products), jsonArray(details.coreTechnologies), jsonArray(details.competitors), now);
    let project = this.database.prepare("SELECT id FROM projects WHERE company_id=? ORDER BY discovery_at LIMIT 1").get(companyId) as { id: string } | undefined;
    if (!project) {
      project = { id: randomUUID() };
      this.database.prepare(`INSERT INTO projects(id,company_id,name,track,subtrack,discovery_at,discovery_reason,status,executive_summary,technology_stage,urgency_score,quality_score,evidence_quality,owner,signal_type,latest_event_at,risk_flags_json,open_questions_json,version,last_researched_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(project.id, companyId, candidate.name, candidate.track, candidate.subtrack ?? "待细分", candidate.eventDate, candidate.discoveryReason, "new", candidate.investmentSummary, "待核验", candidate.scores.signal * 20, candidate.scores.technology * 20, candidate.scores.evidence / 5, null, candidate.signalType, candidate.eventDate, "[]", JSON.stringify(candidate.openQuestions), 1, now);
    } else this.database.prepare(`UPDATE projects SET
      latest_event_at=CASE WHEN date(?)>=date(latest_event_at) THEN ? ELSE latest_event_at END,
      signal_type=CASE WHEN date(?)>=date(latest_event_at) THEN ? ELSE signal_type END,
      executive_summary=CASE WHEN date(?)>=date(latest_event_at) AND trim(?)<>'' THEN ? ELSE executive_summary END,
      open_questions_json=CASE WHEN date(?)>=date(latest_event_at) THEN ? ELSE open_questions_json END,
      version=version+1,last_researched_at=? WHERE id=?`)
      .run(candidate.eventDate, candidate.eventDate, candidate.eventDate, candidate.signalType, candidate.eventDate, candidate.investmentSummary, candidate.investmentSummary, candidate.eventDate, JSON.stringify(candidate.openQuestions), now, project.id);
    const assertions = this.candidateAssertions(candidate.id);
    for (const assertion of assertions) {
      const assertionId = randomUUID();
      this.database.prepare(`INSERT INTO assertions(id,project_id,predicate,label,value_status,epistemic_type,value_json,unit,null_reason,confidence,extraction_method,model_version,status,valid_from,valid_to) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(assertionId, project.id, assertion.field, assertion.label, assertion.valueStatus, assertion.epistemicType === "fact" ? "fact" : assertion.epistemicType, assertion.valueJson, assertion.unit, assertion.valueStatus === "unknown" ? "待补充研究" : assertion.valueStatus === "not_disclosed" ? "公开来源未披露" : null, assertion.confidence, "intelligence_review", "v1", "active", candidate.eventDate, null);
      for (const ref of assertion.evidenceRefs) { const evidenceId = evidenceByRef.get(ref); if (evidenceId) this.database.prepare("INSERT OR IGNORE INTO assertion_evidence(assertion_id,evidence_id,relation) VALUES(?,?,'supports')").run(assertionId, evidenceId); }
    }
    const firstEvidence = evidenceByRef.values().next().value as string | undefined;
    if (firstEvidence) this.database.prepare("INSERT INTO events(id,project_id,event_type,occurred_at,title,summary,confidence,evidence_id) VALUES(?,?,?,?,?,?,?,?)")
      .run(randomUUID(), project.id, candidate.signalType, candidate.eventDate, `${candidate.name}：${candidate.signalType}`, candidate.discoveryReason, candidate.scores.evidence / 5, firstEvidence);
    this.materializeCompanyTransactions(companyId, details, evidenceByRef, candidate.scores.evidence / 5, now);
  }

  private promotePerson(candidate: IntelligenceCandidateView, personId: string, exists: boolean, now: string): void {
    const details = evidenceBackedDetails((candidate.details.person ?? {}) as Record<string, unknown>, this.candidateAssertions(candidate.id), {
      organization: ["organization", "subjectIdentity"], title: ["title"], education: ["education"], employment: ["employment"], technicalBackground: ["technicalBackground"], publications: ["publications"], patents: ["patents", "papersPatents"], homepage: ["homepage"], reports: ["reports"],
    });
    if (!exists) this.database.prepare("INSERT INTO people(id,name,aliases_json,current_organization,current_title,track,previous_startups_json,technical_evidence_count,privacy_basis,confidence,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(personId, candidate.name, "[]", nullableString(details.organization), nullableString(details.title), candidate.track, "[]", candidate.evidence?.length ?? 1, "professional_profile", candidate.scores.evidence / 5, now);
    else this.database.prepare("UPDATE people SET current_organization=COALESCE(?,current_organization),current_title=COALESCE(?,current_title),track=COALESCE(?,track),technical_evidence_count=MAX(technical_evidence_count,?),confidence=MAX(confidence,?) WHERE id=?")
      .run(nullableString(details.organization), nullableString(details.title), candidate.track, candidate.evidence?.length ?? 1, candidate.scores.evidence / 5, personId);
    this.database.prepare(`INSERT INTO person_profile_details(person_id,education_json,employment_json,technical_background,publications_json,patents_json,homepage,reports_json,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(person_id) DO UPDATE SET education_json=CASE WHEN excluded.education_json='[]' THEN education_json ELSE excluded.education_json END,employment_json=CASE WHEN excluded.employment_json='[]' THEN employment_json ELSE excluded.employment_json END,technical_background=COALESCE(excluded.technical_background,technical_background),publications_json=CASE WHEN excluded.publications_json='[]' THEN publications_json ELSE excluded.publications_json END,patents_json=CASE WHEN excluded.patents_json='[]' THEN patents_json ELSE excluded.patents_json END,homepage=COALESCE(excluded.homepage,homepage),reports_json=CASE WHEN excluded.reports_json='[]' THEN reports_json ELSE excluded.reports_json END,updated_at=excluded.updated_at`)
      .run(personId, jsonArray(details.education), jsonArray(details.employment), nullableString(details.technicalBackground), jsonArray(details.publications), jsonArray(details.patents), nullableString(details.homepage), jsonArray(details.reports), now);
  }

  private promoteTechnology(candidate: IntelligenceCandidateView, technologyId: string, exists: boolean, now: string): void {
    const details = evidenceBackedDetails((candidate.details.technology ?? {}) as Record<string, unknown>, this.candidateAssertions(candidate.id), {
      normalizedName: ["normalizedName", "subjectIdentity", "definition"], definition: ["definition"], maturity: ["maturity"], keyMetrics: ["keyMetrics"], papers: ["papers", "papersPatents"], patents: ["patents", "papersPatents"], alternatives: ["alternatives"], competitors: ["competitors"],
    });
    if (!exists) this.database.prepare(`INSERT INTO technologies(id,name,normalized_name,track,subtrack,definition,maturity,key_metrics_json,papers_json,patents_json,alternatives_json,competitors_json,investment_summary,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(technologyId, candidate.name, stringOr(details.normalizedName, candidate.name.replace(/\s/gu, "")), candidate.track, candidate.subtrack, stringOr(details.definition, candidate.discoveryReason), stringOr(details.maturity, "unknown"), jsonArray(details.keyMetrics), jsonArray(details.papers), jsonArray(details.patents), jsonArray(details.alternatives), jsonArray(details.competitors), candidate.investmentSummary, 1, now, now);
    else this.database.prepare(`UPDATE technologies SET normalized_name=COALESCE(?,normalized_name),track=?,subtrack=COALESCE(?,subtrack),definition=COALESCE(?,definition),maturity=COALESCE(?,maturity),key_metrics_json=CASE WHEN ?='[]' THEN key_metrics_json ELSE ? END,papers_json=CASE WHEN ?='[]' THEN papers_json ELSE ? END,patents_json=CASE WHEN ?='[]' THEN patents_json ELSE ? END,alternatives_json=CASE WHEN ?='[]' THEN alternatives_json ELSE ? END,competitors_json=CASE WHEN ?='[]' THEN competitors_json ELSE ? END,investment_summary=?,version=version+1,updated_at=? WHERE id=?`)
      .run(nullableString(details.normalizedName), candidate.track, candidate.subtrack, nullableString(details.definition), nullableString(details.maturity), jsonArray(details.keyMetrics), jsonArray(details.keyMetrics), jsonArray(details.papers), jsonArray(details.papers), jsonArray(details.patents), jsonArray(details.patents), jsonArray(details.alternatives), jsonArray(details.alternatives), jsonArray(details.competitors), jsonArray(details.competitors), candidate.investmentSummary, now, technologyId);
  }

  private materializeCompanyTransactions(companyId: string, details: Record<string, unknown>, evidenceByRef: Map<string, string>, confidence: number, now: string): void {
    for (const event of objectArray(details.fundingHistory)) {
      const announcedAt = stringOr(event.announcedAt, "");
      const round = stringOr(event.round, "other");
      const stored = this.database.prepare("SELECT * FROM investment_events WHERE company_id=? AND round=? AND announced_at=? ORDER BY created_at LIMIT 1").get(companyId, round, announcedAt) as Record<string, unknown> | undefined;
      const id = stored ? String(stored.id) : `intelligence-investment-${hash(`${companyId}:${round}:${announcedAt}`).slice(0, 24)}`;
      const evidenceIds = stringArray(event.sourceRefs).flatMap((ref) => evidenceByRef.get(ref) ? [evidenceByRef.get(ref)!] : []);
      const existingEvidence = stored ? stringArray(JSON.parse(String(stored.source_refs_json))) : [];
      const investors = uniqueStrings([...(stored ? stringArray(JSON.parse(String(stored.investors_json))) : []), ...stringArray(event.investors)]);
      const leadInvestors = uniqueStrings([...(stored ? stringArray(JSON.parse(String(stored.lead_investors_json))) : []), ...stringArray(event.leadInvestors)]);
      this.database.prepare(`INSERT INTO investment_events(id,company_id,round,announced_at,amount,currency,disclosure_type,investors_json,lead_investors_json,confidence,source_refs_json,created_at,valuation)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET amount=excluded.amount,currency=excluded.currency,disclosure_type=excluded.disclosure_type,investors_json=excluded.investors_json,lead_investors_json=excluded.lead_investors_json,confidence=excluded.confidence,source_refs_json=excluded.source_refs_json,valuation=excluded.valuation`)
        .run(id, companyId, round, announcedAt, nullableNumber(event.amount) ?? nullableNumber(stored?.amount), nullableString(event.currency) ?? nullableString(stored?.currency), nullableNumber(event.amount) === null && stored?.amount !== null && stored?.amount !== undefined ? String(stored.disclosure_type) : stringOr(event.disclosureType, "undisclosed"), JSON.stringify(investors), JSON.stringify(leadInvestors), Math.max(confidence, Number(stored?.confidence ?? 0)), JSON.stringify(uniqueStrings([...existingEvidence, ...evidenceIds])), String(stored?.created_at ?? now), nullableNumber(event.valuation) ?? nullableNumber(stored?.valuation));
    }
    for (const event of objectArray(details.mergersAndAcquisitions)) {
      const announcementDate = stringOr(event.announcementDate, "");
      const acquirerName = stringOr(event.acquirerName, "");
      const transactionType = stringOr(event.transactionType, "strategic_investment");
      const stored = this.database.prepare("SELECT * FROM ma_events WHERE target_company_id=? AND acquirer_name=? AND announcement_date=? AND transaction_type=? ORDER BY created_at LIMIT 1").get(companyId, acquirerName, announcementDate, transactionType) as Record<string, unknown> | undefined;
      const id = stored ? String(stored.id) : `intelligence-ma-${hash(`${companyId}:${acquirerName}:${announcementDate}:${transactionType}`).slice(0, 24)}`;
      const evidenceIds = stringArray(event.sourceRefs).flatMap((ref) => evidenceByRef.get(ref) ? [evidenceByRef.get(ref)!] : []);
      const existingEvidence = stored ? stringArray(JSON.parse(String(stored.source_refs_json))) : [];
      this.database.prepare(`INSERT INTO ma_events(id,target_company_id,acquirer_name,announcement_date,transaction_type,transaction_value,currency,transaction_stage,strategic_rationale,source_refs_json,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET transaction_value=excluded.transaction_value,currency=excluded.currency,transaction_stage=excluded.transaction_stage,strategic_rationale=excluded.strategic_rationale,source_refs_json=excluded.source_refs_json`)
        .run(id, companyId, acquirerName, announcementDate, transactionType, nullableNumber(event.transactionValue) ?? nullableNumber(stored?.transaction_value), nullableString(event.currency) ?? nullableString(stored?.currency), stringOr(event.transactionStage, String(stored?.transaction_stage ?? "proposed")), nullableString(event.strategicRationale) ?? nullableString(stored?.strategic_rationale), JSON.stringify(uniqueStrings([...existingEvidence, ...evidenceIds])), String(stored?.created_at ?? now));
    }
  }

  private materializeEvidence(candidateId: string, channel: string, now: string): Map<string, string> {
    const rows = this.database.prepare("SELECT * FROM intelligence_candidate_sources WHERE candidate_id=?").all(candidateId) as Array<Record<string, unknown>>;
    const entries = rows.map((row): [string, string] => {
      const url = String(row.url); const host = new URL(url).hostname;
      const sourceId = `intelligence-source-${hash(`${channel}:${host}:${String(row.access_class)}:${Number(row.allow_external_model)}`).slice(0, 24)}`;
      this.database.prepare(`INSERT OR IGNORE INTO sources(id,name,source_type,authority,access_mode,robots_status,license_notes,policy_status,independent_group,last_checked_at,channel,connector_type,access_class,allowed_storage,allow_external_model,terms_review_status)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(sourceId, host, channel, String(row.authority), String(row.collection_method), "not_applicable", "由候选数据包发现；正式对外使用前需单独完成条款审核。", "manual_only", host, now, channel, String(row.collection_method), String(row.access_class), "metadata_excerpt", 0, "pending");
      const documentHash = String(row.content_hash); const documentId = `intelligence-document-${hash(`${sourceId}:${documentHash}`).slice(0, 24)}`;
      this.database.prepare("INSERT OR IGNORE INTO documents(id,source_id,canonical_url,title,published_at,observed_at,content_hash,raw_excerpt) VALUES(?,?,?,?,?,?,?,?)")
        .run(documentId, sourceId, url, String(row.title), String(row.published_at ?? row.observed_at), String(row.observed_at), documentHash, String(row.excerpt));
      const fragmentHash = hash(`${documentId}:${String(row.excerpt)}`);
      let evidence = this.database.prepare("SELECT id FROM evidence_fragments WHERE fragment_hash=?").get(fragmentHash) as { id: string } | undefined;
      if (!evidence) { evidence = { id: `intelligence-evidence-${fragmentHash.slice(0, 24)}` }; this.database.prepare("INSERT INTO evidence_fragments(id,document_id,quoted_context,fragment_hash) VALUES(?,?,?,?)").run(evidence.id, documentId, String(row.excerpt), fragmentHash); }
      this.database.prepare("UPDATE intelligence_candidate_sources SET canonical_evidence_id=? WHERE id=?").run(evidence.id, String(row.id));
      return [String(row.source_ref), evidence.id];
    });
    return new Map(entries);
  }

  private materializeEntityAssertions(candidate: IntelligenceCandidateView, entityId: string, evidenceByRef: Map<string, string>, now: string): void {
    for (const assertion of this.candidateAssertions(candidate.id)) {
      const evidenceIds = assertion.evidenceRefs.flatMap((ref) => evidenceByRef.get(ref) ? [evidenceByRef.get(ref)!] : []);
      this.database.prepare(`INSERT INTO entity_assertions(id,entity_type,entity_id,candidate_id,field_key,label,value_status,epistemic_type,value_json,unit,confidence,evidence_ids_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(randomUUID(), candidate.entityType, entityId, candidate.id, assertion.field, assertion.label, assertion.valueStatus, assertion.epistemicType, assertion.valueJson, assertion.unit, assertion.confidence, JSON.stringify(evidenceIds), now);
    }
  }

  private materializeEntityRelationships(candidate: IntelligenceCandidateView, entityId: string, evidenceByRef: Map<string, string>, now: string): void {
    const rows = this.database.prepare("SELECT * FROM intelligence_candidate_relationships WHERE candidate_id=?").all(candidate.id) as Array<Record<string, unknown>>;
    for (const relationship of rows) {
      const refs = JSON.parse(String(relationship.evidence_refs_json)) as string[];
      const evidenceIds = refs.flatMap((ref) => evidenceByRef.get(ref) ? [evidenceByRef.get(ref)!] : []);
      const relatedType = String(relationship.related_entity_type);
      const relatedId = nullableString(relationship.related_entity_id);
      this.database.prepare(`INSERT INTO entity_relationships(id,source_entity_type,source_entity_id,target_entity_type,target_entity_id,target_name,relation_type,confidence,candidate_id,evidence_ids_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
        .run(randomUUID(), candidate.entityType, entityId, relatedType, relatedId, String(relationship.related_name), String(relationship.relation_type), Number(relationship.confidence), candidate.id, JSON.stringify(evidenceIds), now);
      if (candidate.entityType === "company" && relatedType === "person" && relatedId && this.database.prepare("SELECT 1 FROM people WHERE id=?").get(relatedId)) {
        this.database.prepare("INSERT OR IGNORE INTO person_company_roles(person_id,company_id,role) VALUES(?,?,?)").run(relatedId, entityId, String(relationship.relation_type));
      }
      if (candidate.entityType === "person" && relatedType === "company" && relatedId && this.database.prepare("SELECT 1 FROM companies WHERE id=?").get(relatedId)) {
        this.database.prepare("INSERT OR IGNORE INTO person_company_roles(person_id,company_id,role) VALUES(?,?,?)").run(entityId, relatedId, String(relationship.relation_type));
      }
    }
  }

  private materializeContacts(candidate: IntelligenceCandidateView, entityId: string, evidenceByRef: Map<string, string>, reviewedBy: string, now: string): void {
    if (candidate.entityType === "technology") return;
    const contacts = this.database.prepare("SELECT * FROM intelligence_candidate_contacts WHERE candidate_id=?").all(candidate.id) as Array<Record<string, unknown>>;
    for (const contact of contacts) {
      const source = this.database.prepare("SELECT url,access_class FROM intelligence_candidate_sources WHERE candidate_id=? AND source_ref=?").get(candidate.id, String(contact.source_ref)) as { url: string; access_class: string } | undefined;
      if (!source || !evidenceByRef.has(String(contact.source_ref))) continue;
      if (source.access_class !== "public") continue;
      this.database.prepare(`INSERT OR IGNORE INTO entity_public_contacts(id,entity_type,entity_id,contact_type,contact_value,source_url,verified_at,public_basis,created_at,evidence_id,reviewed_by,review_candidate_id) VALUES(?,?,?,?,?,?,?,'public_work_contact',?,?,?,?)`)
        .run(randomUUID(), candidate.entityType, entityId, String(contact.contact_type), String(contact.contact_value), source.url, String(contact.verified_at), now, evidenceByRef.get(String(contact.source_ref))!, reviewedBy, candidate.id);
    }
  }

  private candidateAssertions(candidateId: string): Array<{ field: string; label: string; valueStatus: string; epistemicType: string; valueJson: string | null; unit: string | null; confidence: number; evidenceRefs: string[] }> {
    const rows = this.database.prepare("SELECT * FROM intelligence_candidate_assertions WHERE candidate_id=?").all(candidateId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({ field: String(row.field_key), label: String(row.label), valueStatus: String(row.value_status), epistemicType: String(row.epistemic_type), valueJson: row.value_json === null ? null : String(row.value_json), unit: row.unit === null ? null : String(row.unit), confidence: Number(row.confidence), evidenceRefs: JSON.parse(String(row.evidence_refs_json)) as string[] }));
  }

  private findWriteRequest(actorId: string, idempotencyKey: string, action: string, payload: string): { resourceId: string } | null {
    const row = this.database.prepare("SELECT action,resource_id,payload_json FROM workbench_idempotency WHERE actor_id=? AND idempotency_key=?").get(actorId, idempotencyKey) as { action: string; resource_id: string; payload_json: string } | undefined;
    if (!row) return null;
    if (row.action !== action || row.payload_json !== payload) throw new IntelligenceDiscoveryError("IDEMPOTENCY_CONFLICT", "幂等键已用于不同写入请求。");
    return { resourceId: row.resource_id };
  }

  private entityExists(entityType: EntityType, entityId: string): boolean {
    const table = entityType === "company" ? "companies" : entityType === "person" ? "people" : "technologies";
    return Boolean(this.database.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(entityId));
  }

  private recordWriteRequest(actorId: string, idempotencyKey: string, action: string, resourceId: string, payload: string, now: string): void {
    this.database.prepare("INSERT INTO workbench_idempotency(actor_id,idempotency_key,action,resource_id,payload_json,created_at) VALUES(?,?,?,?,?,?)")
      .run(actorId, idempotencyKey, action, resourceId, payload, now);
  }
}

function mapCandidate(row: CandidateRow): IntelligenceCandidateView {
  return { id: row.id, legacyProjectCandidateId: row.legacy_project_candidate_id, externalId: row.external_id, entityType: row.entity_type, candidateKind: row.candidate_kind, name: row.subject_name, track: row.track, subtrack: row.subtrack, city: row.city, signalType: row.signal_type, eventDate: row.event_date, channel: row.source_channel, discoveryReason: row.discovery_reason, investmentSummary: row.investment_summary, investmentHighlights: JSON.parse(row.investment_highlights_json), priority: row.priority_band, scores: JSON.parse(row.scores_json), completeness: row.completeness_level, openQuestions: JSON.parse(row.open_questions_json), missingFields: JSON.parse(row.missing_fields_json), matchedEntityType: row.matched_entity_type, matchedEntityId: row.matched_entity_id, matchConfidence: row.match_confidence, matchReason: row.match_reason, status: row.status, version: row.review_version, reviewReason: row.review_reason, promotedEntityId: row.promoted_entity_id, details: JSON.parse(row.details_json), createdAt: row.created_at, updatedAt: row.updated_at };
}
function mapTechnology(row: Record<string, unknown>): Record<string, unknown> { return { id: row.id, name: row.name, normalizedName: row.normalized_name, track: row.track, subtrack: row.subtrack, definition: row.definition, maturity: row.maturity, keyMetrics: JSON.parse(String(row.key_metrics_json)), papers: JSON.parse(String(row.papers_json)), patents: JSON.parse(String(row.patents_json)), alternatives: JSON.parse(String(row.alternatives_json)), competitors: JSON.parse(String(row.competitors_json)), investmentSummary: row.investment_summary, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at }; }
function mapPlan(row: Record<string, unknown>, connectorReady = String(row.connector_type) !== "licensed_api"): Record<string, unknown> { return { id: row.id, name: row.name, channel: row.channel, queryFamily: row.query_family, tracks: JSON.parse(String(row.tracks_json)), subtracks: JSON.parse(String(row.subtracks_json)), cities: JSON.parse(String(row.cities_json)), preferredDomains: JSON.parse(String(row.preferred_domains_json)), dateWindowDays: row.date_window_days, connectorType: row.connector_type, connectorReady, enabled: Boolean(row.enabled), schedule: JSON.parse(String(row.schedule_json)), nextRunAt: row.next_run_at, version: row.version, updatedAt: row.updated_at }; }
function parseAliasedJson(row: Record<string, unknown>, keys: string[]): Record<string, unknown> { return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, keys.includes(key) && typeof value === "string" ? JSON.parse(value) : value])); }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function candidateContentHash(item: IntelligenceCandidateInput): string {
  const { externalId: _externalId, candidateKind: _candidateKind, evidence, ...fact } = item;
  void _externalId; void _candidateKind;
  return hash(JSON.stringify({
    ...fact,
    evidence: evidence.map((source) => ({ ref: source.ref, title: source.title, url: source.url, publishedAt: source.publishedAt, excerpt: source.excerpt, authority: source.authority, accessClass: source.accessClass, collectionMethod: source.collectionMethod, allowExternalModel: source.allowExternalModel })),
  }));
}
function semanticCandidateKey(item: IntelligenceCandidateInput): string {
  const accessClasses = [...new Set(item.evidence.map((evidence) => evidence.accessClass))].sort();
  const details = item.entityType === "company" ? item.company : item.entityType === "person" ? item.person : item.technology;
  return hash(JSON.stringify([item.entityType, normalizeIdentity(item.name), normalizeIdentity(item.city ?? ""), item.signalType, item.eventDate, accessClasses, canonicalSemanticValue(details ?? {})]));
}
function sameCandidateEntity(item: IntelligenceCandidateInput, row: { subject_name: string; city: string | null; details_json: string; access_classes: string | null }): boolean {
  const details = JSON.parse(row.details_json) as Record<string, Record<string, unknown> | undefined>;
  const current = item.entityType === "company" ? item.company : item.entityType === "person" ? item.person : item.technology;
  const stored = details[item.entityType];
  const currentAccessClasses = [...new Set(item.evidence.map((evidence) => evidence.accessClass))].sort().join(",");
  const storedAccessClasses = (row.access_classes ?? "").split(",").filter(Boolean).sort().join(",");
  if (currentAccessClasses !== storedAccessClasses) return false;
  if (JSON.stringify(canonicalSemanticValue(current ?? {})) !== JSON.stringify(canonicalSemanticValue(stored ?? {}))) return false;
  if (item.entityType === "company") {
    const currentCompany = current as IntelligenceCandidateInput["company"];
    const storedCompany = stored ?? {};
    const currentCreditCode = normalizeIdentity(String(currentCompany?.unifiedCreditCode ?? ""));
    const storedCreditCode = normalizeIdentity(String(storedCompany.unifiedCreditCode ?? ""));
    if (currentCreditCode && currentCreditCode === storedCreditCode) return true;
    const currentDomain = websiteDomain(String(currentCompany?.officialWebsite ?? ""));
    const storedDomain = websiteDomain(String(storedCompany.officialWebsite ?? ""));
    if (currentDomain && currentDomain === storedDomain) return true;
    const currentNames = new Set([item.name, String(currentCompany?.legalName ?? "")].map(normalizeIdentity).filter(Boolean));
    const storedNames = [row.subject_name, String(storedCompany.legalName ?? "")].map(normalizeIdentity).filter(Boolean);
    const citiesCompatible = !item.city || !row.city || normalizeIdentity(item.city) === normalizeIdentity(row.city);
    return citiesCompatible && storedNames.some((name) => currentNames.has(name));
  }
  if (normalizeIdentity(item.name) !== normalizeIdentity(row.subject_name)) return false;
  if (item.entityType === "person") {
    const currentOrganization = normalizeIdentity(String((current as IntelligenceCandidateInput["person"])?.organization ?? ""));
    const storedOrganization = normalizeIdentity(String(stored?.organization ?? ""));
    return !currentOrganization || !storedOrganization || currentOrganization === storedOrganization;
  }
  return true;
}
function canonicalSemanticValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalSemanticValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== "sourceRefs")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, canonicalSemanticValue(nested)]));
}
function normalizeIdentity(value: string): string { return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[\s·•・—_()（）\[\]【】.,，。'"“”‘’]/gu, ""); }
function websiteDomain(value: string): string {
  if (!value) return "";
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./u, ""); }
  catch { return ""; }
}
function escapeLike(value: string): string { return value.replace(/[\\%_]/gu, (character) => `\\${character}`); }
function bestMatches(matches: MatchSuggestion[]): MatchSuggestion[] { return [...matches].sort((left, right) => right.confidence - left.confidence).slice(0, 5); }
function batchAllowsCandidate(accessClass: "public" | "licensed_internal" | "user_supplied", item: IntelligenceCandidateInput): boolean {
  if (accessClass === "licensed_internal") return true;
  if (accessClass === "public") return item.evidence.every((evidence) => evidence.accessClass === "public");
  return item.evidence.every((evidence) => evidence.accessClass !== "licensed_internal");
}
function normalizedCandidateScores(item: IntelligenceCandidateInput): CandidateScores {
  const counts: Record<keyof CandidateScores, number> = { technology: 0, team: 0, commercial: 0, signal: item.evidence.length, evidence: item.evidence.length };
  const dimensions: Record<"technology" | "team" | "commercial", RegExp> = {
    technology: /^(products?|coreTechnology|definition|maturity|keyMetrics?|papersPatents|publications|patents)$/iu,
    team: /^(coreTeam|team|education|employment|technicalBackground|founders?)$/iu,
    commercial: /^(commercialValidation|customers?|clients?|revenue|orders?|fundingHistory|partnerships?|marketValidation)$/iu,
  };
  for (const assertion of item.assertions) {
    if (!["known", "estimated"].includes(assertion.valueStatus) || assertion.evidenceRefs.length === 0) continue;
    for (const dimension of ["technology", "team", "commercial"] as const) {
      if (dimensions[dimension].test(assertion.field)) counts[dimension] += assertion.evidenceRefs.length;
    }
  }
  const scores = normalizeScores(item.scores, counts);
  const evidenceCeiling = Math.max(0, ...item.evidence.map((evidence) => ({ A: 5, B: 4, C: 2, D: 1 })[evidence.authority]));
  return { ...scores, evidence: Math.min(scores.evidence, evidenceCeiling) };
}
function requireContext(tenantId: string, actorId: string, idempotencyKey: string): void { if (!tenantId.trim() || !actorId.trim()) throw new IntelligenceDiscoveryError("INVALID_INPUT", "缺少操作身份。"); if (!idempotencyKey.trim() || idempotencyKey.length > 200) throw new IntelligenceDiscoveryError("INVALID_INPUT", "必须提供有效的 Idempotency-Key。"); }
function nullableString(value: unknown): string | null { return value === null || value === undefined ? null : String(value); }
function nullableNumber(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function stringOr(value: unknown, fallback: string): string { return value === null || value === undefined ? fallback : String(value); }
function jsonArray(value: unknown): string { return JSON.stringify(Array.isArray(value) ? value : []); }
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function uniqueStrings(values: readonly string[]): string[] { return [...new Set(values)]; }
function objectArray(value: unknown): Array<Record<string, unknown>> { return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item)) : []; }
function evidenceBackedDetails(
  details: Record<string, unknown>,
  assertions: Array<{ field: string; valueStatus: string; evidenceRefs: string[] }>,
  fieldMappings: Record<string, readonly string[]>,
  alwaysIncluded: readonly string[] = [],
): Record<string, unknown> {
  const supported = new Set(assertions.filter((assertion) => assertion.valueStatus !== "unknown" && assertion.evidenceRefs.length > 0).map((assertion) => assertion.field));
  return Object.fromEntries(Object.entries(details).filter(([key]) => alwaysIncluded.includes(key) || (fieldMappings[key] ?? []).some((field) => supported.has(field))));
}
