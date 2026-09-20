export interface ResearchJob {
  id: string;
  tenantId: string;
  projectId: string;
  idempotencyKey: string;
  status: "queued" | "running" | "succeeded" | "failed";
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  attemptCount?: number;
  errorCode?: string | null;
  workflow?: { id: string; version: string };
  profileId?: string | null;
  profileVersion?: string | null;
  skillRefs?: readonly string[];
  requestedBy?: string | null;
  instructions?: string;
}

export interface ResearchJobRepository {
  findByIdempotencyKey(tenantId: string, idempotencyKey: string): ResearchJob | undefined;
  findActiveByProjectId(tenantId: string, projectId: string): ResearchJob | undefined;
  save(job: ResearchJob): ResearchJob;
}

export class InMemoryResearchJobRepository implements ResearchJobRepository {
  #jobs: readonly ResearchJob[];

  constructor(jobs: readonly ResearchJob[] = []) {
    this.#jobs = [...jobs];
  }

  findByIdempotencyKey(tenantId: string, idempotencyKey: string): ResearchJob | undefined {
    return this.#jobs.find((job) => job.tenantId === tenantId && job.idempotencyKey === idempotencyKey);
  }

  findActiveByProjectId(tenantId: string, projectId: string): ResearchJob | undefined {
    return this.#jobs.find((job) => job.tenantId === tenantId && job.projectId === projectId && (job.status === "queued" || job.status === "running"));
  }

  save(job: ResearchJob): ResearchJob {
    this.#jobs = [...this.#jobs, { ...job }];
    return { ...job };
  }

  list(): ResearchJob[] {
    return this.#jobs.map((job) => ({ ...job }));
  }
}

interface SQLiteDatabase {
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): unknown;
  };
}

export class SqliteResearchJobRepository implements ResearchJobRepository {
  constructor(private readonly database: SQLiteDatabase) {}

  findByIdempotencyKey(tenantId: string, idempotencyKey: string): ResearchJob | undefined {
    const row = this.database.prepare("SELECT * FROM research_jobs WHERE tenant_id = ? AND idempotency_key = ?").get(tenantId, idempotencyKey) as Record<string, string> | undefined;
    return row ? mapRow(row) : undefined;
  }

  findActiveByProjectId(tenantId: string, projectId: string): ResearchJob | undefined {
    const row = this.database.prepare(`SELECT * FROM research_jobs WHERE tenant_id=? AND project_id=?
      AND status IN ('queued','running') ORDER BY created_at,id LIMIT 1`).get(tenantId, projectId) as Record<string, string> | undefined;
    return row ? mapRow(row) : undefined;
  }

  save(job: ResearchJob): ResearchJob {
    this.database.prepare(`INSERT INTO research_jobs
      (id,tenant_id,project_id,idempotency_key,status,created_at,workflow_id,workflow_version,profile_id,profile_version,skill_refs_json,requested_by,instructions)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      job.id,
      job.tenantId,
      job.projectId,
      job.idempotencyKey,
      job.status,
      job.createdAt,
      job.workflow?.id ?? "project-research",
      job.workflow?.version ?? "1.0.0",
      job.profileId ?? null,
      job.profileVersion ?? null,
      JSON.stringify(job.skillRefs ?? []),
      job.requestedBy ?? null,
      job.instructions ?? "",
    );
    return { ...job };
  }
}

function mapRow(row: Record<string, string>): ResearchJob {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    idempotencyKey: row.idempotency_key,
    status: row.status as ResearchJob["status"],
    createdAt: row.created_at,
    startedAt: row.started_at ?? null,
    finishedAt: row.finished_at ?? null,
    attemptCount: Number(row.attempt_count ?? 0),
    errorCode: row.error_code ?? null,
    workflow: { id: row.workflow_id ?? "project-research", version: row.workflow_version ?? "1.0.0" },
    profileId: row.profile_id ?? null,
    profileVersion: row.profile_version ?? null,
    skillRefs: JSON.parse(row.skill_refs_json ?? "[]") as string[],
    requestedBy: row.requested_by ?? null,
    instructions: row.instructions ?? "",
  };
}
