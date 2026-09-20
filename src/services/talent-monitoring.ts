import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { evaluateTalentAlert } from "@/domain/alerts";
import type { PersonEventType, SourceSignal } from "@/domain/types";

/**
 * 人才事件入库用例。
 *
 * 高优先级“离职/创业”告警至少满足：企业/个人明确声明、工商高置信关联、
 * 或两个独立来源交叉确认。单一社交资料变化只生成“待验证”信号。
 */

export interface TalentEventInput {
  personId: string;
  eventType: PersonEventType;
  occurredAt: string;
  summary: string;
  targetCompanyId?: string;
  confidence: number;
  sources: SourceSignal[];
  evidenceId?: string;
}

export interface TalentEventRecord {
  id: string;
  personId: string;
  eventType: PersonEventType;
  occurredAt: string;
  summary: string;
  targetCompanyId: string | null;
  confidence: number;
  alertSeverity: "high" | "medium" | "review";
  dedupeKey: string;
}

export function registerTalentEvent(database: DatabaseSync, input: TalentEventInput): TalentEventRecord {
  if (!input.summary.trim()) throw new Error("A talent event summary is required.");
  if (input.confidence < 0 || input.confidence > 1) throw new Error("Confidence must be between 0 and 1.");

  const decision = evaluateTalentAlert({ eventType: input.eventType, sources: input.sources });
  const dedupeKey = `${input.personId}:${input.eventType}:${input.occurredAt}:${input.targetCompanyId ?? "none"}`;

  const existing = database.prepare("SELECT id FROM person_events WHERE dedupe_key = ?").get(dedupeKey) as { id: string } | undefined;
  if (existing) {
    return { id: existing.id, personId: input.personId, eventType: input.eventType, occurredAt: input.occurredAt, summary: input.summary, targetCompanyId: input.targetCompanyId ?? null, confidence: input.confidence, alertSeverity: decision.severity, dedupeKey };
  }

  const id = randomUUID();
  database.prepare(`INSERT INTO person_events
    (id,person_id,event_type,occurred_at,summary,target_company_id,confidence,alert_severity,evidence_id,dedupe_key,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,
    input.personId,
    input.eventType,
    input.occurredAt,
    input.summary,
    input.targetCompanyId ?? null,
    input.confidence,
    decision.severity,
    input.evidenceId ?? null,
    dedupeKey,
    new Date().toISOString(),
  );

  return { id, personId: input.personId, eventType: input.eventType, occurredAt: input.occurredAt, summary: input.summary, targetCompanyId: input.targetCompanyId ?? null, confidence: input.confidence, alertSeverity: decision.severity, dedupeKey };
}
