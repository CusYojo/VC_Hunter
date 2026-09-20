import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { TRACK_VALUES } from "@/domain/types";
import type { CandidateView } from "./candidate-details";
import { SqliteWorkbenchRepository } from "./repository";
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value);
const editSchema = z.object({
  expectedVersion: z.number().int().positive(), companyName: z.string().trim().min(1).max(200),
  track: z.enum([...TRACK_VALUES, "待分类"]), summary: z.string().trim().min(1).max(8000),
  investorNames: z.array(z.string().trim().min(1).max(200)).max(100),
  eventDate: dateSchema.nullable().default(null), round: z.string().trim().max(120).nullable().default(null),
  amountText: z.string().trim().max(200).nullable().default(null),
}).strict();
export class CandidateAdminError extends Error {
  constructor(readonly code: "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "INVALID_INPUT", message: string) { super(message); }
}
type Owner = { tenantId: string; accountId: string; user: { id: string }; roles: readonly string[] };
export function editCandidate(db: DatabaseSync, owner: Owner, id: string, raw: unknown, key: string): CandidateView {
  if (!owner.roles.includes("org_admin") || !owner.accountId || !owner.tenantId) throw new CandidateAdminError("FORBIDDEN", "只有管理员可以编辑项目内容。");
  if (!key.trim() || key.length > 200) throw new CandidateAdminError("INVALID_INPUT", "必须提供有效幂等键。");
  const parsed = editSchema.parse(raw); const input = { ...parsed, investorNames: [...new Set(parsed.investorNames)] };
  const requestId = createHash("sha256").update(JSON.stringify([owner.tenantId,owner.accountId,key])).digest("hex");
  const payloadHash = createHash("sha256").update(JSON.stringify([id,input])).digest("hex");
  const repository = new SqliteWorkbenchRepository(db);
  db.exec("BEGIN IMMEDIATE");
  try {
    const prior = db.prepare("SELECT after_json FROM audit_log WHERE actor=? AND action='candidate.edited' AND request_id=?").get(owner.user.id, requestId);
    if (prior) {
      const stored = JSON.parse(String(prior.after_json)) as { payloadHash: string; candidate: CandidateView };
      if (stored.payloadHash !== payloadHash) throw new CandidateAdminError("CONFLICT", "幂等键已用于其他编辑请求。");
      db.exec("COMMIT"); return stored.candidate;
    }
    const before = repository.findCandidate(id);
    if (!before) throw new CandidateAdminError("NOT_FOUND", "候选不存在。");
    if (before.status === "promoted") throw new CandidateAdminError("CONFLICT", "已入库，请在正式项目中编辑内容。");
    if (before.version !== input.expectedVersion) throw new CandidateAdminError("CONFLICT", "版本冲突：候选已发生变化。");
    const now = new Date().toISOString();
    const changed = db.prepare("UPDATE project_candidates SET company_name=?,track=?,summary=?,investor_names_json=?,review_version=review_version+1,updated_at=? WHERE id=? AND review_version=?").run(input.companyName,input.track,input.summary,JSON.stringify(input.investorNames),now,id,input.expectedVersion);
    if (Number(changed.changes) !== 1) throw new CandidateAdminError("CONFLICT", "版本冲突：候选已发生变化。");
    db.prepare(`INSERT INTO candidate_details(candidate_id,import_key,origin,event_date,round,amount_text,raw_track,sources_json,verification_notes,raw_input_json,content_hash,imported_by,created_at,updated_at)
      VALUES (?,?,'manual_screenshot',?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(candidate_id) DO UPDATE SET event_date=excluded.event_date,round=excluded.round,amount_text=excluded.amount_text,raw_track=excluded.raw_track,updated_at=excluded.updated_at`)
      .run(id,`admin-edit:${id}`,input.eventDate,input.round,input.amountText,input.track,JSON.stringify(before.sources?.length ? before.sources : [{ title: before.lead.title, url: before.lead.url, publishedAt: before.lead.publishedAt }]),"管理员人工校订；保留原始来源。",JSON.stringify({ original: before }),payloadHash,owner.user.id,now,now);
    const candidate = repository.findCandidate(id)!;
    db.prepare("INSERT INTO audit_log(id,actor,action,resource_type,resource_id,before_json,after_json,note,request_id,created_at) VALUES (?,?,'candidate.edited','project_candidate',?,?,?,?,?,?)")
      .run(randomUUID(),owner.user.id,id,JSON.stringify(before),JSON.stringify({payloadHash,candidate}),"管理员编辑候选基础内容",requestId,now);
    db.prepare("INSERT INTO platform_timeline(id,event_type,subject_type,subject_id,project_id,actor,summary,metadata_json,trace_id,created_at) VALUES (?,'candidate.edited','project_candidate',?,NULL,?,'管理员编辑候选基础内容',?,?,?)")
      .run(randomUUID(),id,owner.user.id,JSON.stringify({fields:["companyName","track","summary","investorNames","eventDate","round","amountText"]}),requestId,now);
    db.exec("COMMIT"); return candidate;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
