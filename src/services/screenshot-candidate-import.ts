import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { TRACK_VALUES } from "../domain/types";

const nullableText = (max: number) => z.string().trim().max(max).nullable().default(null);
const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "日期不是有效的 YYYY-MM-DD。");
const publishedSchema = z.string().trim().max(80).refine((value) => daySchema.safeParse(value.slice(0, 10)).success && (value.length === 10 || !Number.isNaN(Date.parse(value))), "来源发布日期无效。").nullable().default(null);
const sourceSchema = z.object({
  title: z.string().trim().min(1).max(300),
  url: z.string().trim().max(2000).url().refine((value) => { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; }, "必须是公开 HTTP(S) 来源，不得伪造新闻地址。"),
  publishedAt: publishedSchema,
}).strict();

export const screenshotCandidateSchema = z.object({
  companyName: z.string().trim().min(1).max(200), track: nullableText(200), eventDate: daySchema.nullable().default(null),
  round: nullableText(100), amountText: nullableText(300), valuation: nullableText(300),
  investorNames: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
  summary: z.string().trim().min(1).max(8000), sources: z.array(sourceSchema).max(30).default([]),
  verificationNotes: nullableText(8000), sourceScreenshot: nullableText(1000),
  sourceRow: z.union([z.string().trim().min(1).max(100), z.number().int().positive()]).nullable().default(null).transform((value) => value === null ? null : String(value)),
  eventType: nullableText(100),
}).strict();
type ScreenshotCandidate = z.infer<typeof screenshotCandidateSchema>;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const companyKey = (value: string) => value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/\s+/g, "");
const identityKey = (name: string, date: string | null) => hash(JSON.stringify([companyKey(name), date]));

export function prepareScreenshotCandidates(raw: unknown) {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as { items?: unknown; candidates?: unknown }).items ?? (raw as { candidates?: unknown }).candidates : raw;
  const rows = z.array(screenshotCandidateSchema).min(1).max(2000).parse(input);
  const entries = rows.map((row) => ({ row, importKey: identityKey(row.companyName, row.eventDate), contentHash: hash(JSON.stringify(row)) }));
  if (new Set(entries.map((entry) => entry.importKey)).size !== entries.length) throw new Error("同批存在重复的机构/公司名称与事件日期，请先人工合并。");
  return { entries, summary: { rows: rows.length, uniqueCandidates: entries.length, withSources: rows.filter((row) => row.sources.length).length,
    withoutSources: rows.filter((row) => !row.sources.length).length, unclassified: rows.filter((row) => !TRACK_VALUES.includes(row.track as never)).length,
    undated: rows.filter((row) => !row.eventDate).length } };
}

type ExistingCandidate = { id: string; lead_id: string; company_name: string; status: string; event_date: string | null; import_key: string | null; content_hash: string | null };

/** Validate first, then one transaction. Never touches projects, assignments or companies. */
export function importScreenshotCandidates(database: DatabaseSync, raw: unknown, options: { actor: string; now?: string }) {
  const prepared = prepareScreenshotCandidates(raw);
  const actor = z.string().trim().min(1).max(200).parse(options.actor);
  const now = options.now ? z.string().datetime().parse(options.now) : new Date().toISOString();
  const result = { inserted: 0, updated: 0, skipped: 0, reviewedSkipped: 0 };
  database.exec("BEGIN IMMEDIATE");
  try {
    const existing = database.prepare(`SELECT pc.id,pc.lead_id,pc.company_name,pc.status,cd.import_key,cd.content_hash,
      CASE WHEN cd.candidate_id IS NOT NULL THEN cd.event_date ELSE substr(wsl.published_at,1,10) END AS event_date
      FROM project_candidates pc JOIN web_search_leads wsl ON wsl.id=pc.lead_id LEFT JOIN candidate_details cd ON cd.candidate_id=pc.id`).all() as unknown as ExistingCandidate[];
    for (const entry of prepared.entries) {
      const found = existing.find((candidate) => candidate.import_key === entry.importKey || identityKey(candidate.company_name, candidate.event_date) === entry.importKey);
      if (found && (found.status !== "pending_review" || found.content_hash === entry.contentHash)) {
        result.skipped += 1;
        if (found.status !== "pending_review") result.reviewedSkipped += 1;
        continue;
      }
      const candidateId = found?.id ?? `candidate-screenshot-${entry.importKey}`;
      const leadId = found?.lead_id ?? `lead-screenshot-${entry.importKey}`;
      if (!found) createArchiveLead(database, leadId, entry.row, entry.importKey, now);
      writeCandidate(database, candidateId, leadId, entry.row, now, Boolean(found));
      writeDetails(database, candidateId, entry, actor, now);
      database.prepare(`INSERT INTO platform_timeline (id,event_type,subject_type,subject_id,project_id,actor,summary,metadata_json,trace_id,created_at)
        VALUES (?,'candidate.manual_import','project_candidate',?,NULL,?,?,?,?,?)`).run(randomUUID(), candidateId, actor, `${entry.row.companyName} 截图线索${found ? "已更新" : "已进入待复核"}`,
        JSON.stringify({ importKey: entry.importKey, sourceScreenshot: entry.row.sourceScreenshot, sourceRow: entry.row.sourceRow, eventDate: entry.row.eventDate }), randomUUID(), now);
      if (found) result.updated += 1; else result.inserted += 1;
    }
    database.exec("COMMIT");
    return { ...result, ...prepared.summary };
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}

function createArchiveLead(database: DatabaseSync, leadId: string, row: ScreenshotCandidate, importKey: string, now: string) {
  // An archive identity, not a fabricated article; real public URLs are only in sources_json.
  database.prepare(`INSERT INTO web_search_leads (id,url,title,published_at,highlights_json,first_seen_at,last_seen_at,status)
    VALUES (?,?,?,?,?,?,?,'discovered')`).run(leadId, `manual://screenshot/${importKey}`, `${row.companyName} · 截图线索存档`, row.eventDate, JSON.stringify([row.summary]), now, now);
}

function writeCandidate(database: DatabaseSync, id: string, leadId: string, row: ScreenshotCandidate, now: string, exists: boolean) {
  const track = TRACK_VALUES.includes(row.track as never) ? row.track : "待分类";
  if (exists) {
    database.prepare(`UPDATE project_candidates SET company_name=?,track=?,investor_names_json=?,signal_type=?,summary=?,confidence=0,
      model='manual_screenshot',prompt_version='manual-import-v1',review_version=review_version+1,updated_at=? WHERE id=? AND status='pending_review'`)
      .run(row.companyName, track, JSON.stringify(row.investorNames), row.eventType || "manual_screenshot", row.summary, now, id);
  } else {
    database.prepare(`INSERT INTO project_candidates (id,lead_id,company_name,track,investor_names_json,signal_type,summary,confidence,status,model,prompt_version,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,0,'pending_review','manual_screenshot','manual-import-v1',?,?)`).run(id, leadId, row.companyName, track, JSON.stringify(row.investorNames), row.eventType || "manual_screenshot", row.summary, now, now);
  }
}

function writeDetails(database: DatabaseSync, id: string, entry: ReturnType<typeof prepareScreenshotCandidates>["entries"][number], actor: string, now: string) {
  const row = entry.row;
  database.prepare(`INSERT INTO candidate_details (candidate_id,import_key,origin,event_date,round,amount_text,valuation,raw_track,event_type,sources_json,
    verification_notes,source_screenshot,source_row,raw_input_json,content_hash,imported_by,created_at,updated_at)
    VALUES (?,?,'manual_screenshot',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(candidate_id) DO UPDATE SET import_key=excluded.import_key,origin=excluded.origin,event_date=excluded.event_date,round=excluded.round,
    amount_text=excluded.amount_text,valuation=excluded.valuation,raw_track=excluded.raw_track,event_type=excluded.event_type,sources_json=excluded.sources_json,
    verification_notes=excluded.verification_notes,source_screenshot=excluded.source_screenshot,source_row=excluded.source_row,raw_input_json=excluded.raw_input_json,
    content_hash=excluded.content_hash,imported_by=excluded.imported_by,updated_at=excluded.updated_at`)
    .run(id, entry.importKey, row.eventDate, row.round, row.amountText, row.valuation, row.track, row.eventType, JSON.stringify(row.sources), row.verificationNotes,
      row.sourceScreenshot, row.sourceRow, JSON.stringify(row), entry.contentHash, actor, now, now);
}
