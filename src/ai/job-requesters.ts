import type { DatabaseSync } from "node:sqlite";
import { getAuthService } from "@/auth/server";
import type { WorkspaceIdentity } from "@/security/identity-scope";
import { PersonalAIRequiredError, createPersonalModelGateway } from "./personal-model";
export type AIJobType = "research" | "discovery" | "document";
type Requester = Pick<WorkspaceIdentity, "tenantId" | "accountId">;
export function bindJobAIRequester(database: DatabaseSync, type: AIJobType, jobId: string, identity: Requester): void {
  if (!identity.tenantId.trim() || !identity.accountId.trim()) throw new PersonalAIRequiredError();
  const existing = database.prepare("SELECT tenant_id,account_id FROM job_ai_requesters WHERE job_type=? AND job_id=?").get(type, jobId);
  if (existing) {
    if (existing.tenant_id !== identity.tenantId || existing.account_id !== identity.accountId) throw new Error("该任务由另一位成员发起，请等待其完成。");
    return;
  }
  database.prepare("INSERT INTO job_ai_requesters(job_type,job_id,tenant_id,account_id) VALUES (?,?,?,?)").run(type, jobId, identity.tenantId, identity.accountId);
}
export function resolveJobAIRequester(database: DatabaseSync, type: AIJobType, jobId: string): Requester {
  const row = database.prepare("SELECT tenant_id,account_id FROM job_ai_requesters WHERE job_type=? AND job_id=?").get(type, jobId);
  if (!row) throw new PersonalAIRequiredError();
  const identity = { tenantId: String(row.tenant_id), accountId: String(row.account_id) };
  const membership = getAuthService().membershipFor(identity.accountId);
  if (!membership || membership.tenantId !== identity.tenantId || identity.tenantId !== process.env.VC_HUNTER_CURRENT_TENANT_ID || !membership.roles.some((role) => ["org_admin", "investment_manager", "researcher"].includes(role))) throw new Error("AI 请求者已无权执行该任务。");
  return identity;
}
export function createJobModelGateway(database: DatabaseSync, type: AIJobType, jobId: string, fetchImpl: typeof fetch = fetch) {
  return createPersonalModelGateway(database, resolveJobAIRequester(database, type, jobId), fetchImpl);
}
