import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { isOperationKind, operationConfigs, type OperationKind, type OperationRecord, type OperationWorkspace } from "./business-operation-contracts";
import { insertOperationDocuments, operationDocumentBytes, operationDocuments, operationUploadFingerprint, validateOperationUploads, type OperationUpload } from "./business-operation-documents";
export type OperationActor = { tenantId: string; id: string; roles: readonly string[] };
const canWrite = (actor: OperationActor) => actor.roles.some((role) => ["org_admin", "investment_manager"].includes(role));
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
function kindConfig(kind: string) { if (!isOperationKind(kind)) throw new Error("记录类型不存在。"); return operationConfigs[kind]; }
function parseInput(kind: string, input: unknown) {
  const config = kindConfig(kind);
  const shape: Record<string, z.ZodType> = {};
  for (const field of config.fields) {
    let schema: z.ZodType = field.type === "documents" ? z.array(z.string().min(1).max(128)).max(50) : field.type === "money" ? z.number().min(0).max(1e12).refine((v) => Number(v.toFixed(2)) === v, "金额最多两位小数") : field.type === "year" ? z.number().int().min(1900).max(2200) : field.type === "date" ? z.string().refine(validDate, "日期无效") : z.string().trim().min(1).max(field.type === "textarea" ? 10000 : 500);
    if (!field.required) schema = schema.optional();
    shape[field.key] = schema;
  }
  const schema = z.object({ name: z.string().trim().min(1).max(200), status: z.string().refine((v) => Object.hasOwn(config.statuses, v)), data: z.object(shape).strict() }).strict();
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new Error("请检查必填信息、金额、日期和状态。");
  if (kind === "payment" && parsed.data.status === "paid" && (!parsed.data.data.paidOn || !parsed.data.data.reference)) throw new Error("登记已付款需填写实际付款日和凭证编号。");
  if (kind === "fund" && Number(parsed.data.data.calledCny) > Number(parsed.data.data.amountCny)) throw new Error("实缴金额不能超过认缴金额。");
  return { ...parsed.data, data: parsed.data.data as OperationRecord["data"] };
}
function requireWriter(actor: OperationActor) { if (!canWrite(actor)) throw new Error("当前账号没有管理权限。"); }
function rowToRecord(db: DatabaseSync, row: Record<string, unknown>): OperationRecord {
  const record = { id: String(row.id), kind: row.kind as OperationKind, name: String(row.name), status: String(row.status), data: JSON.parse(String(row.data_json)), version: Number(row.version), archived: Boolean(row.archived), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
  const documents = operationDocuments(db, String(row.tenant_id), record);
  return { ...record, ...(documents.length ? { documents } : {}) };
}
function getRecord(db: DatabaseSync, actor: OperationActor, kind: string, id: string) {
  const row = db.prepare("SELECT * FROM business_operation_records WHERE id=? AND tenant_id=? AND kind=?").get(id, actor.tenantId, kind);
  if (!row) throw new Error("记录不存在。");
  return rowToRecord(db, row);
}
export function listOperations(db: DatabaseSync, actor: OperationActor, kind: string, includeArchived = false): OperationRecord[] {
  kindConfig(kind);
  return db.prepare(`SELECT * FROM business_operation_records WHERE tenant_id=? AND kind=? ${includeArchived ? "" : "AND archived=0"} ORDER BY updated_at DESC,id`).all(actor.tenantId, kind).map(row => rowToRecord(db, row));
}
export function getOperationWorkspace(db: DatabaseSync, actor: OperationActor, kind: string, includeArchived = false): OperationWorkspace {
  return { records: listOperations(db, actor, kind, includeArchived), canWrite: canWrite(actor), projects: db.prepare("SELECT id,name FROM projects ORDER BY name").all() as OperationWorkspace["projects"], funds: listOperations(db, actor, "fund").map(({ id, name }) => ({ id, name })), documents: db.prepare("SELECT id,project_id AS projectId,original_name AS originalName FROM project_documents ORDER BY created_at DESC").all() as OperationWorkspace["documents"] };
}
function validateRelations(db: DatabaseSync, actor: OperationActor, data: OperationRecord["data"]) {
  if (data.fundId && !db.prepare("SELECT id FROM business_operation_records WHERE id=? AND tenant_id=? AND kind='fund' AND archived=0").get(String(data.fundId), actor.tenantId)) throw new Error("关联基金不存在或已归档。");
  if (data.projectId && !db.prepare("SELECT id FROM projects WHERE id=?").get(String(data.projectId))) throw new Error("关联项目不存在。");
  const documents = (data.documentIds ?? []) as string[];
  for (const id of documents) if (!db.prepare("SELECT d.id FROM project_documents d JOIN projects p ON p.id=d.project_id WHERE d.id=?").get(id)) throw new Error("关联项目资料不存在。");
}
function audit(db: DatabaseSync, actor: OperationActor, action: string, next: OperationRecord, previous?: OperationRecord) { db.prepare("INSERT INTO business_operation_audit VALUES (?,?,?,?,?,?,?,?)").run(randomUUID(), actor.tenantId, next.id, actor.id, action, previous ? JSON.stringify(previous) : null, JSON.stringify(next), next.updatedAt); }
export function createOperation(db: DatabaseSync, actor: OperationActor, kind: string, input: unknown, key: string, options: { files?: readonly OperationUpload[] } = {}): OperationRecord {
  requireWriter(actor); const parsed = parseInput(kind, input);
  const files = validateOperationUploads(options.files);
  if (!key.trim() || key.length > 200) throw new Error("幂等键无效。");
  const payload = JSON.stringify({ kind, ...parsed, ...(files.length ? { files: operationUploadFingerprint(files) } : {}) });
  db.exec("BEGIN IMMEDIATE");
  try {
    const prior = db.prepare("SELECT payload_json,record_id FROM business_operation_requests WHERE tenant_id=? AND actor_id=? AND request_key=?").get(actor.tenantId, actor.id, key);
    if (prior) { if (prior.payload_json !== payload) throw new Error("幂等键已用于不同请求。"); const result = getRecord(db, actor, kind, String(prior.record_id)); db.exec("COMMIT"); return result; }
    validateRelations(db, actor, parsed.data);
    const id = randomUUID(), now = new Date().toISOString();
    db.prepare("INSERT INTO business_operation_records (id,tenant_id,kind,name,status,data_json,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(id, actor.tenantId, kind, parsed.name, parsed.status, JSON.stringify(parsed.data), actor.id, actor.id, now, now);
    insertOperationDocuments(db, actor.tenantId, actor.id, id, files, now);
    db.prepare("INSERT INTO business_operation_requests VALUES (?,?,?,?,?)").run(actor.tenantId, actor.id, key, payload, id);
    const result = getRecord(db, actor, kind, id); audit(db, actor, "create", result); db.exec("COMMIT"); return result;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
export function updateOperation(db: DatabaseSync, actor: OperationActor, kind: string, id: string, input: unknown, options: { files?: readonly OperationUpload[]; idempotencyKey?: string } = {}): OperationRecord {
  requireWriter(actor); kindConfig(kind);
  const files = validateOperationUploads(options.files);
  const key = options.idempotencyKey;
  if ((files.length && !key) || (key !== undefined && (!key.trim() || key.length > 200))) throw new Error("幂等键无效。");
  const parsed = z.object({ version: z.number().int().positive(), archived: z.boolean().optional(), name: z.string().optional(), status: z.string().optional(), data: z.record(z.string(), z.unknown()).optional() }).strict().safeParse(input);
  if (!parsed.success) throw new Error("更新参数无效。");
  const payload = JSON.stringify({ kind, id, ...parsed.data, files: operationUploadFingerprint(files) });
  db.exec("BEGIN IMMEDIATE");
  try {
    if (key) {
      const prior = db.prepare("SELECT payload_json,result_json FROM business_operation_update_requests WHERE tenant_id=? AND actor_id=? AND request_key=?").get(actor.tenantId, actor.id, key);
      if (prior) {
        if (prior.payload_json !== payload) throw new Error("幂等键已用于不同请求。");
        getRecord(db, actor, kind, id);
        db.exec("COMMIT"); return JSON.parse(String(prior.result_json)) as OperationRecord;
      }
    }
    const previous = getRecord(db, actor, kind, id);
    if (previous.version !== parsed.data.version) throw new Error("版本冲突：记录已更新，请刷新后重试。");
    if (kind === "fund" && parsed.data.archived === true && db.prepare("SELECT id FROM business_operation_records WHERE tenant_id=? AND archived=0 AND json_extract(data_json,'$.fundId')=? LIMIT 1").get(actor.tenantId, id)) throw new Error("基金仍关联未归档记录，请先处理关联记录。");
    const value = parseInput(kind, { name: parsed.data.name ?? previous.name, status: parsed.data.status ?? previous.status, data: parsed.data.data ?? previous.data });
    if (parsed.data.data !== undefined || parsed.data.archived === false) validateRelations(db, actor, value.data);
    const now = new Date().toISOString();
    db.prepare("UPDATE business_operation_records SET name=?,status=?,data_json=?,archived=?,version=version+1,updated_by=?,updated_at=? WHERE id=? AND tenant_id=?").run(value.name, value.status, JSON.stringify(value.data), Number(parsed.data.archived ?? previous.archived), actor.id, now, id, actor.tenantId);
    insertOperationDocuments(db, actor.tenantId, actor.id, id, files, now);
    const result = getRecord(db, actor, kind, id); audit(db, actor, parsed.data.archived === true ? "archive" : parsed.data.archived === false ? "restore" : "update", result, previous);
    if (key) db.prepare("INSERT INTO business_operation_update_requests VALUES (?,?,?,?,?,?)").run(actor.tenantId, actor.id, key, payload, id, JSON.stringify(result));
    db.exec("COMMIT"); return result;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function readOperationDocument(db: DatabaseSync, actor: OperationActor, kind: string, id: string, documentId: string, storageRoot?: string) {
  if (!actor.roles.some(role => ["org_admin", "investment_manager", "researcher", "viewer", "compliance_reviewer"].includes(role))) throw new Error("当前账号没有查看权限。");
  kindConfig(kind);
  return operationDocumentBytes(db, actor.tenantId, getRecord(db, actor, kind, id), documentId, storageRoot);
}
