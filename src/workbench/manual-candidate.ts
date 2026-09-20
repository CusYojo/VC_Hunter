import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { TRACK_VALUES } from "@/domain/types";
import { validateProjectDocument } from "./document-policy";
import { SqliteWorkbenchRepository } from "./repository";
const inputSchema = z.object({ companyName: z.string().trim().min(1).max(200), track: z.enum(TRACK_VALUES), summary: z.string().trim().min(1).max(8000), investorNames: z.string().max(1000).default(""), sourceText: z.string().max(50000).default("") }).strict();
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export function createManualCandidate(db: DatabaseSync, raw: unknown, file: { name: string; mimeType: string; bytes: Uint8Array }, owner: { tenantId: string; accountId: string }, key: string) {
  const input = inputSchema.parse(raw);
  if (!key.trim() || key.length > 200 || !owner.accountId || !owner.tenantId) throw new Error("必须提供有效的身份与幂等键。");
  const valid = validateProjectDocument(file);
  const importKey = `manual-upload:${hash(JSON.stringify([owner.tenantId,owner.accountId,key]))}`;
  const payloadHash = hash(JSON.stringify([input,file.name,hash(file.bytes)]));
  const existing = db.prepare("SELECT candidate_id,content_hash FROM candidate_details WHERE import_key=?").get(importKey);
  if (existing) {
    if (existing.content_hash !== payloadHash) throw new Error("幂等键已用于不同请求。");
    return new SqliteWorkbenchRepository(db).listCandidates().find((candidate) => candidate.id === existing.candidate_id)!;
  }
  const id = randomUUID(); const leadId = `manual-lead-${id}`; const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT INTO web_search_leads(id,url,title,published_at,highlights_json,first_seen_at,last_seen_at,status) VALUES (?,?,?,NULL,?,?,?,'discovered')").run(leadId,`/api/v1/candidates/${id}/document?download=1`,file.name,JSON.stringify([input.sourceText || input.summary]),now,now);
    db.prepare("INSERT INTO project_candidates(id,lead_id,company_name,track,investor_names_json,signal_type,summary,confidence,status,model,prompt_version,created_at,updated_at) VALUES (?,?,?,?,?,'manual_upload',?,0,'pending_review','human','manual-upload-v1',?,?)").run(id,leadId,input.companyName,input.track,JSON.stringify(input.investorNames.split(/[、,，;；\n]/).map((value) => value.trim()).filter(Boolean)),input.summary,now,now);
    db.prepare("INSERT INTO candidate_details(candidate_id,import_key,origin,raw_track,event_type,verification_notes,source_screenshot,raw_input_json,content_hash,imported_by,created_at,updated_at) VALUES (?,?,'manual_screenshot',?,'manual_upload',?,?,?,?,?,?,?)").run(id,importKey,input.track,"用户上传资料并人工确认，仅保存在本站；资料内容尚待核验。",file.name,JSON.stringify(input),payloadHash,owner.accountId,now,now);
    db.prepare("INSERT INTO candidate_documents(candidate_id,original_name,media_type,document_kind,byte_length,bytes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)").run(id,file.name,file.mimeType || "application/octet-stream",valid.kind,file.bytes.byteLength,file.bytes,owner.accountId,now);
    db.prepare("INSERT INTO platform_timeline(id,event_type,subject_type,subject_id,project_id,actor,summary,metadata_json,trace_id,created_at) VALUES (?,'candidate.created','project_candidate',?,NULL,?,?,?,?,?)").run(randomUUID(),id,owner.accountId,"人工导入资料并确认候选线索",JSON.stringify({originalName:file.name,sha256:hash(file.bytes)}),importKey,now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    const raced = db.prepare("SELECT candidate_id,content_hash FROM candidate_details WHERE import_key=?").get(importKey);
    if (raced) {
      if (raced.content_hash !== payloadHash) throw new Error("幂等键已用于不同请求。");
      return new SqliteWorkbenchRepository(db).listCandidates().find((candidate) => candidate.id === raced.candidate_id)!;
    }
    throw error;
  }
  return new SqliteWorkbenchRepository(db).listCandidates().find((candidate) => candidate.id === id)!;
}
export function getCandidateDocument(db: DatabaseSync, candidateId: string) {
  return db.prepare("SELECT original_name AS name,document_kind AS kind,bytes,byte_length AS byteLength FROM candidate_documents WHERE candidate_id=?").get(candidateId) as { name: string; kind: "pdf" | "docx" | "text" | "markdown"; bytes: Uint8Array; byteLength: number } | undefined;
}
