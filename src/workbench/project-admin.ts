import { notifyProjectCreated } from "./notifications";
import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { SqliteProjectRepository, type ProjectDetail } from "@/repositories/projects";
import { createAdminProjectSchema, updateAdminProjectSchema } from "./project-admin-contracts";

export type ProjectAdminActor = { tenantId: string; id: string; roles: readonly string[] };
export class ProjectAdminError extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = "ProjectAdminError"; }
}
function authorize(actor: ProjectAdminActor, key: string) {
  if (!actor.tenantId.trim() || !actor.id.trim() || !actor.roles.includes("org_admin")) throw new ProjectAdminError("仅工作空间管理员可以新建或编辑项目内容。", 403);
  if (!key.trim() || key.length > 200) throw new ProjectAdminError("请提供有效的幂等键。");
}
function existingRequest(db: DatabaseSync, actor: ProjectAdminActor, action: string, key: string, hash: string) {
  const existing = db.prepare("SELECT resource_id,after_json FROM audit_log WHERE actor=? AND action=? AND request_id=?").get(actor.id, action, key);
  if (!existing) return undefined;
  if (JSON.parse(String(existing.after_json)).requestPayloadHash !== hash) throw new ProjectAdminError("幂等键已用于不同请求。", 409);
  const project = new SqliteProjectRepository(db).findById(String(existing.resource_id));
  if (!project) throw new ProjectAdminError("项目不存在。", 404);
  return project;
}
function recordAudit(db: DatabaseSync, actor: ProjectAdminActor, action: string, project: ProjectDetail, key: string, hash: string, now: string, previous?: ProjectDetail) {
  const summary = action === "project.created" ? "管理员新建项目" : "管理员更新项目内容";
  db.prepare("INSERT INTO audit_log(id,actor,action,resource_type,resource_id,before_json,after_json,note,request_id,created_at) VALUES (?,?,?,'project',?,?,?,?,?,?)")
    .run(randomUUID(), actor.id, action, project.id, JSON.stringify(previous ?? null), JSON.stringify({ ...project, requestPayloadHash: hash }), summary, key, now);
  db.prepare("INSERT INTO platform_timeline(id,event_type,subject_type,subject_id,project_id,actor,summary,metadata_json,trace_id,created_at) VALUES (?,?,'project',?,?,?,?,?,?,?)")
    .run(randomUUID(), action, project.id, project.id, actor.id, summary, JSON.stringify({ version: project.version, previousVersion: previous?.version ?? null }), key, now);
}
function requestHash(actor: ProjectAdminActor, payload: unknown) { return createHash("sha256").update(JSON.stringify({ tenantId: actor.tenantId, payload })).digest("hex"); }

export function createAdminProject(db: DatabaseSync, actor: ProjectAdminActor, raw: unknown, key: string): ProjectDetail {
  authorize(actor, key);
  const input = createAdminProjectSchema.parse(raw);
  const hash = requestHash(actor, input);
  db.exec("BEGIN IMMEDIATE");
  try {
    const repeated = existingRequest(db, actor, "project.created", key, hash);
    if (repeated) { db.exec("COMMIT"); return repeated; }
    const legalName = input.legalName ?? input.name;
    const company = db.prepare("SELECT id FROM companies WHERE legal_name=? ORDER BY id LIMIT 1").get(legalName);
    const companyId = company ? String(company.id) : randomUUID();
    if (!company) db.prepare("INSERT INTO companies(id,legal_name,aliases_json,official_domain,region_scope) VALUES (?,?,'[]',NULL,'中国')").run(companyId, legalName);
    const id = randomUUID(), now = new Date().toISOString();
    db.prepare(`INSERT INTO projects(id,company_id,name,track,subtrack,discovery_at,discovery_reason,status,executive_summary,technology_stage,
      urgency_score,quality_score,evidence_quality,owner,signal_type,latest_event_at,risk_flags_json,open_questions_json,version,last_researched_at,score_urgency,score_quality,score_evidence)
      VALUES (?,?,?,?,?,?,?,?,?,?,-1,-1,-1,NULL,?,?,?,?,1,?,NULL,NULL,NULL)`)
      .run(id, companyId, input.name, input.track, input.subtrack ?? "待分类", now, input.discoveryReason ?? "管理员新建项目", input.status ?? "new", input.executiveSummary ?? "", input.technologyStage ?? "待评估", input.signalType ?? "manual", now, JSON.stringify(input.riskFlags ?? []), JSON.stringify(input.openQuestions ?? []), now);
    const project = new SqliteProjectRepository(db).findById(id)!;
    recordAudit(db, actor, "project.created", project, key, hash, now);
    notifyProjectCreated(db, project, actor.id, now);
    db.exec("COMMIT"); return project;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

const updateColumns = { name: "name", track: "track", subtrack: "subtrack", executiveSummary: "executive_summary", technologyStage: "technology_stage", discoveryReason: "discovery_reason", status: "status", signalType: "signal_type", riskFlags: "risk_flags_json", openQuestions: "open_questions_json" } as const;
export function updateAdminProject(db: DatabaseSync, actor: ProjectAdminActor, id: string, raw: unknown, key: string): ProjectDetail {
  authorize(actor, key);
  const input = updateAdminProjectSchema.parse(raw);
  const hash = requestHash(actor, { id, ...input });
  db.exec("BEGIN IMMEDIATE");
  try {
    const repeated = existingRequest(db, actor, "project.updated", key, hash);
    if (repeated) { db.exec("COMMIT"); return repeated; }
    const repository = new SqliteProjectRepository(db), previous = repository.findById(id);
    if (!previous) throw new ProjectAdminError("项目不存在。", 404);
    if (previous.version !== input.expectedVersion) throw new ProjectAdminError("版本冲突：项目已更新，请刷新后重新编辑。", 409);
    const entries = Object.entries(updateColumns).filter(([key]) => input[key as keyof typeof input] !== undefined);
    const values = entries.map(([key]) => {
      const value = input[key as keyof typeof input]; return Array.isArray(value) ? JSON.stringify(value) : String(value);
    });
    const now = new Date().toISOString();
    const result = db.prepare(`UPDATE projects SET ${entries.map(([, column]) => `${column}=?`).join(",")},version=version+1,latest_event_at=? WHERE id=? AND version=?`).run(...values, now, id, input.expectedVersion);
    if (Number(result.changes) !== 1) throw new ProjectAdminError("版本冲突：项目已更新，请刷新后重新编辑。", 409);
    const project = repository.findById(id)!;
    recordAudit(db, actor, "project.updated", project, key, hash, now, previous);
    db.exec("COMMIT"); return project;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
