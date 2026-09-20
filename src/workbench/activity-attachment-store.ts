import { assertActivityActive } from "./approval-lifecycle";
import { isActivityCommentImage, validatePreparedCommentImage } from "./activity-comment-images";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { MAX_PROJECT_DOCUMENT_BYTES, validateProjectDocument } from "./document-policy";
import type { WorkspaceActivityDocument } from "./activity-contracts";
export interface ActivityFile { name: string; mimeType: string; bytes: Uint8Array }
export function prepareActivityFiles(files: readonly ActivityFile[], options: { allowImages?: boolean } = {}) {
  if (files.length > 10) throw new Error("最多上传 10 个文件。");
  if (files.reduce((size, file) => size + file.bytes.byteLength, 0) > MAX_PROJECT_DOCUMENT_BYTES) throw new Error("本次附件总大小不能超过 20 MB。");
  return files.map(file => {
    if (!file.name.trim() || file.name.length > 240 || /[/\\\x00-\x1f\x7f]/.test(file.name)) throw new Error("文件名无效。");
    if (options.allowImages && isActivityCommentImage(file)) return { ...file, ...validatePreparedCommentImage(file) };
    const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
    const mimeType = file.mimeType && file.mimeType !== "application/octet-stream" ? file.mimeType : ({ pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", txt: "text/plain", md: "text/markdown", markdown: "text/markdown" }[extension] ?? "");
    return { ...file, mimeType, ...validateProjectDocument({ ...file, mimeType }) };
  });
}
export type PreparedActivityFile = ReturnType<typeof prepareActivityFiles>[number];
export function filePayload(file: PreparedActivityFile) { return { name: file.name, mimeType: file.mimeType, sha256: file.sha256 }; }
export function insertActivityFile(db: DatabaseSync, id: string, file: PreparedActivityFile, actor: string, key: string, now: string) {
  db.prepare(`INSERT INTO workspace_activity_documents(id,activity_id,original_name,media_type,document_kind,byte_length,content,uploaded_by,created_at,idempotency_key,input_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), id, file.name, file.mimeType, file.kind, file.bytes.byteLength, file.bytes, actor, now, key, JSON.stringify(filePayload(file)));
}
export function validateProjectFileReferences(db: DatabaseSync, ids: readonly string[]) {
  for (const id of ids) if (!db.prepare("SELECT id FROM project_documents WHERE id=?").get(id)) throw new Error("关联资料不存在。");
}
export function insertProjectFileReferences(db: DatabaseSync, activityId: string, ids: readonly string[], actor: string, now: string) {
  const insert = db.prepare("INSERT OR IGNORE INTO activity_project_documents(id,activity_id,project_document_id,added_by,created_at) VALUES (?,?,?,?,?)");
  return ids.reduce((count, id) => count + Number(insert.run(randomUUID(), activityId, id, actor, now).changes), 0);
}
export function activityDocuments(db: DatabaseSync, id: string): WorkspaceActivityDocument[] {
  const uploads = db.prepare("SELECT id,original_name AS originalName,document_kind AS kind,byte_length AS byteLength,created_at AS createdAt,'upload' AS source FROM workspace_activity_documents WHERE activity_id=? ORDER BY created_at,id").all(id);
  const references = db.prepare(`SELECT r.id,d.original_name AS originalName,d.document_kind AS kind,d.byte_length AS byteLength,r.created_at AS createdAt,
    'project' AS source,d.id AS projectDocumentId,d.project_id AS projectId,p.name AS projectName FROM activity_project_documents r
    JOIN project_documents d ON d.id=r.project_document_id JOIN projects p ON p.id=d.project_id WHERE r.activity_id=? ORDER BY r.created_at,r.id`).all(id);
  return [...uploads, ...references].map(row => ({ ...row })) as unknown as WorkspaceActivityDocument[];
}
export function assertAttachmentsMutable(db: DatabaseSync, row: Record<string, unknown>, actor: string, members: readonly string[], expectedVersion: number) {
  if (row.created_by !== actor || !members.includes(actor)) throw new Error("没有上传此事项资料的权限。");
  assertActivityActive(row);
  const responses = db.prepare("SELECT action FROM workspace_activity_responses WHERE activity_id=?").all(String(row.id));
  if (responses.some(item => ["approved", "returned", "done"].includes(String(item.action))) || (responses.length > 0 && responses.every(item => item.action === "declined"))) throw new Error("事项已处理，不能继续添加资料。");
  if (Number(row.version) !== expectedVersion) throw new Error("版本冲突：请刷新后重试。");
}
