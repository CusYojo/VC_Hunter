import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { OperationDocument, OperationRecord } from "./business-operation-contracts";
import { validateProjectDocument, type ProjectDocumentKind } from "./document-policy";
import { readProjectDocument } from "./project-document-content";

export type OperationUpload = { name: string; mimeType: string; bytes: Uint8Array };
export class OperationAttachmentError extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = "OperationAttachmentError"; }
}
const mimeTypes: Record<ProjectDocumentKind, string> = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", text: "text/plain", markdown: "text/markdown" };
const extensions: Record<string, ProjectDocumentKind> = { ".pdf": "pdf", ".docx": "docx", ".txt": "text", ".md": "markdown", ".markdown": "markdown" };
export function validateOperationUploads(files: readonly OperationUpload[] = []) {
  if (files.length > 10) throw new OperationAttachmentError("每次最多上传 10 个附件。");
  if (files.reduce((sum, file) => sum + file.bytes.byteLength, 0) > 20 * 1024 * 1024) throw new OperationAttachmentError("本次附件总大小不能超过 20 MB。", 413);
  return files.map(file => {
    if (!file.name.trim() || file.name.length > 255) throw new OperationAttachmentError("附件文件名不能为空或超过 255 个字符。");
    const kind = extensions[extname(file.name).toLowerCase()];
    const mimeType = (!file.mimeType || file.mimeType === "application/octet-stream") && kind ? mimeTypes[kind] : file.mimeType;
    try {
      const validated = validateProjectDocument({ ...file, mimeType });
      return { ...file, kind: validated.kind, sha256: validated.sha256, mimeType: mimeTypes[validated.kind] };
    } catch (error) {
      throw new OperationAttachmentError(error instanceof Error ? error.message : "附件格式无效。");
    }
  });
}
export type ValidatedOperationUpload = ReturnType<typeof validateOperationUploads>[number];
export const operationUploadFingerprint = (files: readonly ValidatedOperationUpload[]) => files.map(({ name, mimeType, sha256 }) => ({ name, mimeType, sha256 }));

/** Called only within the same transaction as the parent record and audit. */
export function insertOperationDocuments(db: DatabaseSync, tenantId: string, actorId: string, recordId: string, files: readonly ValidatedOperationUpload[], now: string) {
  const insert = db.prepare("INSERT INTO business_operation_documents(id,tenant_id,record_id,original_name,document_kind,media_type,byte_length,sha256,content,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  for (const file of files) insert.run(randomUUID(), tenantId, recordId, file.name, file.kind, file.mimeType, file.bytes.byteLength, file.sha256, file.bytes, actorId, now);
}
export function operationDocuments(db: DatabaseSync, tenantId: string, record: Pick<OperationRecord, "id" | "data">): OperationDocument[] {
  const uploads = db.prepare("SELECT id,original_name AS originalName,document_kind AS kind,byte_length AS byteLength,created_at AS createdAt,'upload' AS source FROM business_operation_documents WHERE tenant_id=? AND record_id=? ORDER BY created_at,rowid").all(tenantId, record.id) as unknown as OperationDocument[];
  const lookup = db.prepare(`SELECT d.id,d.original_name AS originalName,d.document_kind AS kind,d.byte_length AS byteLength,d.created_at AS createdAt,
    'project' AS source,d.project_id AS projectId,d.id AS projectDocumentId,p.name AS projectName
    FROM project_documents d JOIN projects p ON p.id=d.project_id WHERE d.id=?`);
  const references = [...new Set((record.data.documentIds ?? []) as string[])].flatMap(id => {
    const row = lookup.get(id); return row ? [row as unknown as OperationDocument] : [];
  });
  return [...uploads, ...references];
}
export function operationDocumentBytes(db: DatabaseSync, tenantId: string, record: Pick<OperationRecord, "id" | "data">, documentId: string, storageRoot?: string) {
  const uploaded = db.prepare("SELECT original_name,document_kind,media_type,content FROM business_operation_documents WHERE tenant_id=? AND record_id=? AND id=?").get(tenantId, record.id, documentId);
  if (uploaded) {
    const kind = uploaded.document_kind as ProjectDocumentKind;
    if (!Object.hasOwn(mimeTypes, kind)) throw new OperationAttachmentError("附件文件不可用。", 404);
    return { originalName: String(uploaded.original_name), kind, mediaType: mimeTypes[kind], bytes: new Uint8Array(uploaded.content as Uint8Array) };
  }
  if (!((record.data.documentIds ?? []) as string[]).includes(documentId)) throw new OperationAttachmentError("附件不存在或已取消引用。", 404);
  const source = db.prepare("SELECT d.project_id FROM project_documents d JOIN projects p ON p.id=d.project_id WHERE d.id=?").get(documentId);
  if (!source) throw new OperationAttachmentError("关联项目资料不存在。", 404);
  try { return readProjectDocument(db, String(source.project_id), documentId, storageRoot); }
  catch { throw new OperationAttachmentError("附件原文件暂不可用，请联系资料上传者。", 404); }
}
