import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
export { filterCandidateQueue } from "./candidate-queue-contracts";
export class CandidateQueueError extends Error {
  constructor(readonly code: "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "INVALID_INPUT", message: string) { super(message); }
}
function transaction<T>(db: DatabaseSync, operation: () => T): T {
  db.exec("SAVEPOINT candidate_queue_change");
  try { const result = operation(); db.exec("RELEASE candidate_queue_change"); return result; }
  catch (error) { db.exec("ROLLBACK TO candidate_queue_change"); db.exec("RELEASE candidate_queue_change"); throw error; }
}
export function archiveUnassignedCandidates(db: DatabaseSync, now = new Date()): number {
  const cutoff = new Date(now.getTime() - 7 * 86400000).toISOString();
  return transaction(db, () => {
    const rows = db.prepare("SELECT id FROM project_candidates WHERE status='pending_review' AND promoted_project_id IS NULL AND archived_at IS NULL AND julianday(created_at)<julianday(?)").all(cutoff);
    const at = now.toISOString();
    for (const row of rows) {
      db.prepare("UPDATE project_candidates SET archived_at=?,archive_reason='超过七天未分配，自动归档',review_version=review_version+1,updated_at=? WHERE id=?").run(at, at, row.id);
      db.prepare(`INSERT INTO platform_timeline(id,event_type,subject_type,subject_id,project_id,actor,summary,metadata_json,trace_id,created_at)
        VALUES (?,'candidate.archived','project_candidate',?,NULL,'system:queue-policy','候选超过七天未分配，已自动归档，原件保留',?,?,?)`).run(randomUUID(), row.id, JSON.stringify({ cutoff, retainedOriginals: true }), `candidate-archive:${row.id}`, at);
    }
    return rows.length;
  });
}
const batchOrderSchema = z.object({ items: z.array(z.object({ id: z.string().trim().min(1).max(128), expectedVersion: z.number().int().positive(), rank: z.number().int().min(0).max(1000000) }).strict()).min(1).max(100) }).strict().refine(value => new Set(value.items.map(item => item.id)).size === value.items.length, "不能重复指定候选。");
const moveSchema = z.object({ move: z.object({ id: z.string().trim().min(1).max(128), expectedVersion: z.number().int().positive(), direction: z.enum(["up", "down"]) }).strict() }).strict();
const orderSchema = z.union([batchOrderSchema, moveSchema]);
type OrderItem = z.infer<typeof batchOrderSchema>["items"][number];
function moveOrderItems(db: DatabaseSync, move: z.infer<typeof moveSchema>["move"]): OrderItem[] {
  const current = db.prepare("SELECT created_at,status,review_version FROM project_candidates WHERE id=?").get(move.id);
  if (!current) throw new CandidateQueueError("NOT_FOUND", "候选不存在。");
  if (Number(current.review_version) !== move.expectedVersion) throw new CandidateQueueError("CONFLICT", "版本冲突：候选已发生变化。");
  const rows = db.prepare("SELECT id,review_version,queue_rank FROM project_candidates WHERE date(created_at,'+8 hours')=date(?,'+8 hours') AND (status='dismissed')=? ORDER BY queue_rank,created_at DESC,id").all(current.created_at, Number(current.status === "dismissed"));
  const index = rows.findIndex(row => row.id === move.id); const neighbor = index + (move.direction === "up" ? -1 : 1);
  if (neighbor < 0 || neighbor >= rows.length) return rows.map(row => ({ id: String(row.id), expectedVersion: Number(row.review_version), rank: Number(row.queue_rank) }));
  const reordered = rows.map((row, at) => at === index ? rows[neighbor] : at === neighbor ? rows[index] : row);
  return reordered.map((row, rank) => ({ id: String(row.id), expectedVersion: Number(row.review_version), rank }));
}
type OrderOwner = { tenantId: string; accountId: string; user: { id: string }; roles: readonly string[] };
type OrderResult = { items: Array<{ id: string; version: number; queueRank: number }> };
export function orderCandidateQueue(db: DatabaseSync, owner: OrderOwner, raw: unknown, key: string): OrderResult {
  if (!owner.roles.includes("org_admin") || !owner.tenantId || !owner.accountId) throw new CandidateQueueError("FORBIDDEN", "只有管理员可以调整项目顺序。");
  if (!key.trim() || key.length > 200) throw new CandidateQueueError("INVALID_INPUT", "必须提供有效幂等键。");
  const parsed = orderSchema.parse(raw);
  const hashInput = "items" in parsed ? [...parsed.items].sort((a,b) => a.id.localeCompare(b.id)) : parsed;
  const hash = createHash("sha256").update(JSON.stringify(hashInput)).digest("hex");
  return transaction(db, () => {
    const prior = db.prepare("SELECT payload_hash,result_json FROM candidate_queue_order_requests WHERE tenant_id=? AND account_id=? AND request_key=?").get(owner.tenantId, owner.accountId, key);
    if (prior) { if (prior.payload_hash !== hash) throw new CandidateQueueError("CONFLICT", "幂等键已用于其他排序请求。"); return JSON.parse(String(prior.result_json)) as OrderResult; }
    const items = "move" in parsed ? moveOrderItems(db, parsed.move) : [...parsed.items].sort((a,b) => a.id.localeCompare(b.id));
    const now = new Date().toISOString();
    const results = items.map(item => {
      const current = db.prepare("SELECT queue_rank,review_version FROM project_candidates WHERE id=?").get(item.id);
      if (!current) throw new CandidateQueueError("NOT_FOUND", "候选不存在。");
      if (Number(current.review_version) !== item.expectedVersion) throw new CandidateQueueError("CONFLICT", "版本冲突：候选已发生变化。");
      if ("move" in parsed && Number(current.queue_rank) === item.rank) return { id: item.id, version: Number(current.review_version), queueRank: item.rank };
      const updated = db.prepare("UPDATE project_candidates SET queue_rank=?,review_version=review_version+1,updated_at=? WHERE id=? AND review_version=?").run(item.rank, now, item.id, item.expectedVersion);
      if (Number(updated.changes) !== 1) throw new CandidateQueueError("CONFLICT", "版本冲突：候选已发生变化。");
      const after = { id: item.id, version: item.expectedVersion + 1, queueRank: item.rank };
      db.prepare(`INSERT INTO audit_log(id,actor,action,resource_type,resource_id,before_json,after_json,note,request_id,created_at)
        VALUES (?,?,'candidate.reordered','project_candidate',?,?,?,?,?,?)`).run(randomUUID(), owner.user.id, item.id, JSON.stringify({ queueRank: current.queue_rank, version: current.review_version }), JSON.stringify(after), "管理员调整待查看项目顺序", `candidate-order:${owner.accountId}:${key}:${item.id}`, now);
      return after;
    });
    const result = { items: results };
    db.prepare("INSERT INTO candidate_queue_order_requests(tenant_id,account_id,request_key,payload_hash,result_json,created_at) VALUES (?,?,?,?,?,?)").run(owner.tenantId, owner.accountId, key, hash, JSON.stringify(result), now);
    return result;
  });
}
