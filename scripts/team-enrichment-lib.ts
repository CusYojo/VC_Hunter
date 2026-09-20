import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export interface TeamEvidence {
  ref: string;
  title: string;
  url: string;
  publishedAt?: string;
  excerpt: string;
  authority: "A" | "B" | "C";
  accessClass: "public" | "licensed" | "private";
  collectionMethod: "web_search" | "rss" | "api" | "codex" | "manual_upload" | "legacy";
  allowExternalModel?: boolean;
}

export interface TeamEnrichment {
  candidateId: string;
  subjectName: string;
  value: string;
  confidence: number;
  evidence: TeamEvidence[];
}

interface CandidateRow {
  subject_name: string;
  missing_fields_json: string;
}

interface AssertionRow {
  id: string;
  value_status: string;
  value_json: string | null;
  evidence_refs_json: string;
}

function contentHash(url: string, excerpt: string): string {
  return createHash("sha256").update(`${url}\n${excerpt}`).digest("hex");
}

function parseStringArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("候选项目字段格式无效");
  }
  return parsed;
}

function validateEnrichment(item: TeamEnrichment): void {
  if (!item.candidateId || !item.subjectName || !item.value.trim()) throw new Error("团队补充信息不完整");
  if (item.confidence < 0 || item.confidence > 1) throw new Error(`${item.subjectName} 的置信度必须在 0 到 1 之间`);
  if (item.evidence.length === 0) throw new Error(`${item.subjectName} 缺少团队信息来源`);
  const refs = item.evidence.map((source) => source.ref);
  if (new Set(refs).size !== refs.length) throw new Error(`${item.subjectName} 的来源编号重复`);
}

export function applyTeamEnrichments(
  database: DatabaseSync,
  enrichments: TeamEnrichment[],
  now: string,
): { applied: number; skipped: number } {
  let applied = 0;
  let skipped = 0;
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const item of enrichments) {
      validateEnrichment(item);
      const candidate = database.prepare(
        "SELECT subject_name,missing_fields_json FROM intelligence_candidates WHERE id=?",
      ).get(item.candidateId) as CandidateRow | undefined;
      if (!candidate) throw new Error(`找不到候选项目：${item.subjectName}`);
      if (candidate.subject_name !== item.subjectName) throw new Error(`${item.subjectName} 的候选项目名称不匹配`);

      const assertions = database.prepare(
        "SELECT id,value_status,value_json,evidence_refs_json FROM intelligence_candidate_assertions WHERE candidate_id=? AND field_key='coreTeam' ORDER BY id",
      ).all(item.candidateId) as unknown as AssertionRow[];
      const known = assertions.find((assertion) => assertion.value_status === "known");
      if (known) {
        const currentValue = known.value_json === null ? null : JSON.parse(known.value_json);
        if (currentValue !== item.value) throw new Error(`${item.subjectName} 已有不同的核心团队信息`);
        skipped += 1;
        continue;
      }

      for (const source of item.evidence) {
        const existing = database.prepare(
          "SELECT url FROM intelligence_candidate_sources WHERE candidate_id=? AND source_ref=?",
        ).get(item.candidateId, source.ref) as { url: string } | undefined;
        if (existing && existing.url !== source.url) throw new Error(`${item.subjectName} 的来源编号与已有链接冲突`);
        if (!existing) {
          database.prepare(`INSERT INTO intelligence_candidate_sources(
            id,candidate_id,source_ref,title,url,published_at,observed_at,excerpt,authority,
            access_class,collection_method,allow_external_model,content_hash
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
            randomUUID(), item.candidateId, source.ref, source.title, source.url,
            source.publishedAt ?? null, now, source.excerpt, source.authority,
            source.accessClass, source.collectionMethod, Number(source.allowExternalModel ?? false),
            contentHash(source.url, source.excerpt),
          );
        }
      }

      const evidenceRefs = JSON.stringify(item.evidence.map((source) => source.ref));
      const unknown = assertions[0];
      if (unknown) {
        database.prepare(`UPDATE intelligence_candidate_assertions SET
          label='核心团队',value_status='known',epistemic_type='fact',value_json=?,unit=NULL,
          confidence=?,evidence_refs_json=? WHERE id=?`).run(
          JSON.stringify(item.value), item.confidence, evidenceRefs, unknown.id,
        );
        for (const duplicate of assertions.slice(1)) {
          database.prepare("DELETE FROM intelligence_candidate_assertions WHERE id=?").run(duplicate.id);
        }
      } else {
        database.prepare(`INSERT INTO intelligence_candidate_assertions(
          id,candidate_id,field_key,label,value_status,epistemic_type,value_json,unit,confidence,evidence_refs_json
        ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
          randomUUID(), item.candidateId, "coreTeam", "核心团队", "known", "fact",
          JSON.stringify(item.value), null, item.confidence, evidenceRefs,
        );
      }

      const missingFields = parseStringArray(candidate.missing_fields_json)
        .filter((field) => field !== "coreTeam");
      database.prepare(`UPDATE intelligence_candidates SET
        missing_fields_json=?,review_version=review_version+1,updated_at=? WHERE id=?`).run(
        JSON.stringify(missingFields), now, item.candidateId,
      );
      applied += 1;
    }
    database.exec("COMMIT");
    return { applied, skipped };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
