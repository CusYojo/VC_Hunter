import type { DocumentReviewStatus } from "./project-document-contracts";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DOCUMENT_EXTERNAL_DISABLED_MESSAGE, validateProjectDocument, type ProjectDocumentKind } from "./document-policy";
import { z } from "zod";
import type { ModelGateway } from "@/connectors/model-gateway";
import { extractPdfText } from "./pdf-text";

export interface UploadProjectDocumentInput {
  projectId: string; expectedVersion: number; name: string; mimeType: string; bytes: Uint8Array;
  externalPolicy: "local_only" | "external_allowed"; actorId: string; idempotencyKey: string; storageRoot?: string;
}

export async function uploadProjectDocument(database: DatabaseSync, input: UploadProjectDocumentInput) {
  if (input.externalPolicy !== "local_only") throw new Error(DOCUMENT_EXTERNAL_DISABLED_MESSAGE);
  if (!input.idempotencyKey.trim()) throw new Error("写操作必须提供 Idempotency-Key。");
  const validated = validateProjectDocument(input);
  const idempotencyPayload = JSON.stringify({ projectId: input.projectId, name: input.name, sha256: validated.sha256, externalPolicy: input.externalPolicy });
  const prior = database.prepare("SELECT resource_id,payload_json FROM workbench_idempotency WHERE actor_id=? AND idempotency_key=?").get(input.actorId, input.idempotencyKey) as { resource_id: string; payload_json: string } | undefined;
  if (prior) {
    if (prior.payload_json !== idempotencyPayload) throw new Error("幂等键已用于不同请求。");
    const row = database.prepare("SELECT * FROM project_documents WHERE id=?").get(prior.resource_id) as Record<string, string | number> | undefined;
    if (!row) throw new Error("幂等请求关联的资料不存在。");
    const version = Number((database.prepare("SELECT version FROM projects WHERE id=?").get(input.projectId) as { version: number }).version);
    return { ...mapDocument(row), projectVersion: version };
  }
  const duplicate = database.prepare("SELECT * FROM project_documents WHERE project_id=? AND sha256=?").get(input.projectId, validated.sha256) as Record<string, string | number> | undefined;
  if (duplicate) return { ...mapDocument(duplicate), projectVersion: Number((database.prepare("SELECT version FROM projects WHERE id=?").get(input.projectId) as { version: number }).version) };
  const project = database.prepare("SELECT version FROM projects WHERE id=?").get(input.projectId) as { version: number } | undefined;
  if (!project) throw new Error("项目不存在。");
  if (Number(project.version) !== input.expectedVersion) throw new Error("版本冲突：项目已发生变化。");
  const storageRoot = resolve(input.storageRoot ?? process.env.VC_HUNTER_DOCUMENT_ROOT ?? resolve(process.cwd(), ".data/project-documents"));
  await ensureSecureStorageRoot(storageRoot);
  const storageKey = `${randomUUID()}${validated.extension}`;
  await writeFile(resolve(storageRoot, storageKey), input.bytes, { flag: "wx", mode: 0o600 });
  const id = randomUUID();
  const jobId = randomUUID();
  const now = new Date().toISOString();
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare(`INSERT INTO project_documents
      (id,project_id,original_name,storage_key,media_type,document_kind,byte_length,sha256,confidentiality,external_policy,parse_status,analysis_status,uploaded_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,'internal',?,'queued','queued',?,?,?)`).run(id, input.projectId, input.name, storageKey, input.mimeType, validated.kind, input.bytes.byteLength, validated.sha256, input.externalPolicy, input.actorId, now, now);
    database.prepare(`INSERT INTO document_analysis_jobs (id,document_id,project_id,status,created_at) VALUES (?,?,?,'queued',?)`).run(jobId, id, input.projectId, now);
    const updated = database.prepare("UPDATE projects SET version=version+1,latest_event_at=? WHERE id=? AND version=?").run(now, input.projectId, input.expectedVersion);
    if (Number(updated.changes) !== 1) throw new Error("版本冲突：项目已发生变化。");
    insertTimeline(database, "document.uploaded", "project_document", id, input.projectId, input.actorId, `上传资料：${input.name}`, { externalPolicy: input.externalPolicy, sha256: validated.sha256 }, input.idempotencyKey, now);
    database.prepare("INSERT INTO workbench_idempotency (actor_id,idempotency_key,action,resource_id,payload_json,created_at) VALUES (?,?,?,?,?,?)")
      .run(input.actorId, input.idempotencyKey, "document.upload", id, idempotencyPayload, now);
    database.exec("COMMIT");
    return { id, projectId: input.projectId, originalName: input.name, storageKey, kind: validated.kind, externalPolicy: input.externalPolicy, parseStatus: "queued", analysisStatus: "queued", version: 1, createdAt: now, projectVersion: input.expectedVersion + 1 };
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}

export function listProjectDocuments(database: DatabaseSync, projectId: string) {
  const rows = database.prepare(`SELECT d.*,(SELECT action FROM project_document_annotations a
    WHERE a.document_id=d.id AND a.action!='comment' ORDER BY a.rowid DESC LIMIT 1) AS last_review_action
    FROM project_documents d WHERE project_id=? ORDER BY created_at DESC,id DESC`).all(projectId) as unknown as Array<Record<string, string | number>>;
  return rows.map((row) => {
    const { storageKey, ...document } = mapDocument(row);
    void storageKey;
    const reviewStatus: DocumentReviewStatus = row.last_review_action === "approve" ? "approved" : row.last_review_action === "request_changes" ? "changes_requested" : "pending";
    return { ...document, reviewStatus };
  });
}

export async function analyzeNextDocument(database: DatabaseSync, input: {
  workerId: string; now?: string; storageRoot?: string;
  externalAnalyze?: (text: string, context: { projectId: string; documentId: string }) => Promise<{ summary?: string; risks?: string[] }>;
}) {
  const now = input.now ?? new Date().toISOString();
  const job = claimDocumentJob(database, input.workerId, now);
  if (!job) return { ran: false as const };
  try {
    const root = resolve(input.storageRoot ?? process.env.VC_HUNTER_DOCUMENT_ROOT ?? resolve(process.cwd(), ".data/project-documents"));
    const bytes = await readFile(resolve(root, job.storageKey));
    const text = await extractDocumentText(job.kind, bytes);
    // Fail closed for every job, including historical external_allowed records.
    // External analysis must not resume until server-side approval, classification
    // and budget enforcement are wired into this exact worker path.
    const summary = summarizeLocally(text);
    const risks = extractRisks(text);
    const extractedEvents = extractDocumentEvents(text);
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare("UPDATE project_documents SET parse_status='succeeded',analysis_status='succeeded',extracted_text=?,updated_at=? WHERE id=?").run(text.slice(0, 500_000), now, job.documentId);
      database.prepare("UPDATE document_analysis_jobs SET status='succeeded',finished_at=?,lease_owner=NULL,lease_until=NULL,error_code=NULL WHERE id=? AND lease_owner=?").run(now, job.id, input.workerId);
      database.prepare(`INSERT INTO knowledge_entries
        (id,project_id,track,type,title,content,source_type,source_id,status,version,created_by,created_at,updated_at)
        VALUES (?, ?, (SELECT track FROM projects WHERE id=?), 'document_insight', ?, ?, 'document', ?, 'draft', 1, 'background-agent', ?, ?)`)
        .run(randomUUID(), job.projectId, job.projectId, `${job.originalName} · 资料分析`, [summary, ...risks.map((risk) => `风险：${risk}`)].join("\n"), job.documentId, now, now);
      const insertEvent = database.prepare(`INSERT OR IGNORE INTO document_extracted_events
        (id,document_id,project_id,occurred_at,title,summary,confidence,created_at) VALUES (?,?,?,?,?,?,?,?)`);
      for (const event of extractedEvents) insertEvent.run(randomUUID(), job.documentId, job.projectId, event.occurredAt, "资料事件", event.summary, 0.7, now);
      insertTimeline(database, "document.analyzed", "project_document", job.documentId, job.projectId, "background-agent", `${job.originalName} 已在本地解析并生成知识草稿`, { externalPolicy: "local_only", riskCount: risks.length }, job.id, now);
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
    return { ran: true as const, documentId: job.documentId, textLength: text.length };
  } catch (error) {
    database.prepare("UPDATE project_documents SET parse_status='failed',analysis_status='failed',error_code='DOCUMENT_ANALYSIS_FAILED',updated_at=? WHERE id=?").run(now, job.documentId);
    database.prepare("UPDATE document_analysis_jobs SET status='failed',finished_at=?,lease_owner=NULL,lease_until=NULL,error_code='DOCUMENT_ANALYSIS_FAILED' WHERE id=?").run(now, job.id);
    throw error;
  }
}

export async function extractDocumentText(kind: ProjectDocumentKind, bytes: Uint8Array): Promise<string> {
  if (kind === "text" || kind === "markdown") return Buffer.from(bytes).toString("utf8").trim();
  if (kind === "docx") {
    const mammoth = await import("mammoth");
    return (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value.trim();
  }
  return extractPdfText(bytes);
}

const documentAnalysisSchema = z.object({ summary: z.string().max(4_000), risks: z.array(z.string().max(1_000)).max(20) }).strict();
export const DOCUMENT_ANALYSIS_PROMPT = Object.freeze({ id: "project-document-analysis", version: "1.0.0" });
export function createDocumentExternalAnalyzer(model: ModelGateway) {
  return async (text: string, context: { projectId: string; documentId: string }) => (await model.generateStructured({
    system: "你是硬科技 VC 项目资料分析 Agent。只基于输入文本概括项目变化与风险；事实与判断分离；缺失信息不得补写。输出严格 JSON。",
    user: JSON.stringify({ ...context, extractedText: text }), maxTokens: 2_000, temperature: 0,
  }, documentAnalysisSchema)).data;
}

function claimDocumentJob(database: DatabaseSync, workerId: string, now: string) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const row = database.prepare(`SELECT j.id,j.document_id,j.project_id,d.storage_key,d.document_kind,d.external_policy,d.original_name
      FROM document_analysis_jobs j JOIN project_documents d ON d.id=j.document_id
      WHERE j.status='queued' AND (j.next_attempt_at IS NULL OR j.next_attempt_at<=?) ORDER BY j.created_at,j.id LIMIT 1`).get(now) as Record<string, string> | undefined;
    if (!row) { database.exec("COMMIT"); return undefined; }
    database.prepare("UPDATE document_analysis_jobs SET status='running',attempt_count=attempt_count+1,started_at=coalesce(started_at,?),lease_owner=?,lease_until=? WHERE id=?").run(now, workerId, new Date(Date.parse(now) + 600_000).toISOString(), row.id);
    database.prepare("UPDATE project_documents SET parse_status='processing',analysis_status='processing',updated_at=? WHERE id=?").run(now, row.document_id);
    database.exec("COMMIT");
    return { id: row.id, documentId: row.document_id, projectId: row.project_id, storageKey: row.storage_key, kind: row.document_kind as ProjectDocumentKind, externalPolicy: row.external_policy, originalName: row.original_name };
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}

async function ensureSecureStorageRoot(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stats = await lstat(path);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("资料目录必须是普通目录，不能是符号链接。");
}
function summarizeLocally(text: string) { return text.replace(/\s+/g, " ").slice(0, 600) || "资料未提取到可读文本。"; }
function extractRisks(text: string) { return text.split(/[。！？\n]/).map((item) => item.trim()).filter((item) => /风险|待验证|不确定|尚未|未披露/.test(item)).slice(0, 10); }
export function extractDocumentEvents(text: string) {
  return text
    .split(/[。！？\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .flatMap((summary) => {
      const match = summary.match(/(20\d{2})[-年](\d{1,2})[-月](\d{1,2})(?:日)?/);
      if (!match) return [];
      const [, year, month, day] = match;
      const occurredAt = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).toISOString();
      return [{ occurredAt, summary }];
    })
    .slice(0, 20);
}
// Report the effective policy; legacy consent is not current authorization.
function mapDocument(row: Record<string, string | number>) { return { id: String(row.id), projectId: String(row.project_id), originalName: String(row.original_name), storageKey: String(row.storage_key), kind: String(row.document_kind), mediaType: String(row.media_type), byteLength: Number(row.byte_length), sha256: String(row.sha256), confidentiality: String(row.confidentiality), externalPolicy: "local_only", parseStatus: String(row.parse_status), analysisStatus: String(row.analysis_status), errorCode: row.error_code ? String(row.error_code) : null, version: Number(row.version), createdAt: String(row.created_at) }; }
function insertTimeline(database: DatabaseSync, eventType: string, subjectType: string, subjectId: string, projectId: string, actor: string, summary: string, metadata: unknown, traceId: string, now: string) { database.prepare(`INSERT INTO platform_timeline (id,event_type,subject_type,subject_id,project_id,actor,summary,metadata_json,trace_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), eventType, subjectType, subjectId, projectId, actor, summary, JSON.stringify(metadata), traceId, now); }
