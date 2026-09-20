import { sql, type Kysely } from "kysely";

const TENANT_TABLES = [
  "memberships",
  "companies",
  "projects",
  "project_members",
  "outbound_use_requests",
  "tenant_model_budgets",
  "audit_log",
  "legacy_import_runs",
] as const;

async function enableTenantIsolation(database: Kysely<unknown>): Promise<void> {
  for (const table of TENANT_TABLES) {
    await sql.raw(`ALTER TABLE app.${table} ENABLE ROW LEVEL SECURITY`).execute(database);
    await sql.raw(`ALTER TABLE app.${table} FORCE ROW LEVEL SECURITY`).execute(database);
    await sql.raw(`
      CREATE POLICY tenant_isolation ON app.${table}
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true))
    `).execute(database);
  }
}

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS app`.execute(database);

  await sql`
    CREATE TABLE app.tenants (
      id text PRIMARY KEY,
      auth_organization_id text NOT NULL UNIQUE,
      name text NOT NULL,
      slug text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(database);

  await sql`
    CREATE TABLE app.memberships (
      tenant_id text NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
      id text NOT NULL,
      auth_membership_id text NOT NULL UNIQUE,
      user_id text NOT NULL,
      roles text[] NOT NULL DEFAULT ARRAY[]::text[],
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, id),
      UNIQUE (tenant_id, user_id),
      CHECK (
        cardinality(roles) > 0
        AND roles <@ ARRAY[
          'org_admin',
          'investment_manager',
          'researcher',
          'compliance_reviewer',
          'viewer'
        ]::text[]
      )
    )
  `.execute(database);

  await sql`
    CREATE TABLE app.companies (
      tenant_id text NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
      id text NOT NULL,
      legal_name text NOT NULL,
      aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
      official_domain text,
      region_scope text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, id),
      CHECK (jsonb_typeof(aliases) = 'array')
    )
  `.execute(database);

  await sql`
    CREATE TABLE app.projects (
      tenant_id text NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
      id text NOT NULL,
      company_id text NOT NULL,
      name text NOT NULL,
      track text NOT NULL,
      subtrack text NOT NULL,
      discovery_at timestamptz NOT NULL,
      discovery_reason text NOT NULL,
      status text NOT NULL,
      executive_summary text NOT NULL,
      technology_stage text NOT NULL,
      urgency_score integer NOT NULL CHECK (urgency_score BETWEEN 0 AND 100),
      quality_score integer NOT NULL CHECK (quality_score BETWEEN 0 AND 100),
      evidence_quality double precision NOT NULL CHECK (evidence_quality BETWEEN 0 AND 1),
      signal_type text NOT NULL,
      latest_event_at timestamptz NOT NULL,
      risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
      open_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
      last_researched_at timestamptz NOT NULL,
      visibility text NOT NULL DEFAULT 'restricted'
        CHECK (visibility IN ('tenant', 'restricted')),
      owner_member_id text,
      version integer NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, id),
      FOREIGN KEY (tenant_id, company_id)
        REFERENCES app.companies(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, owner_member_id)
        REFERENCES app.memberships(tenant_id, id) ON DELETE RESTRICT,
      CHECK (jsonb_typeof(risk_flags) = 'array'),
      CHECK (jsonb_typeof(open_questions) = 'array')
    )
  `.execute(database);

  await sql`
    CREATE TABLE app.project_members (
      tenant_id text NOT NULL,
      project_id text NOT NULL,
      membership_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, project_id, membership_id),
      FOREIGN KEY (tenant_id, project_id)
        REFERENCES app.projects(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, membership_id)
        REFERENCES app.memberships(tenant_id, id) ON DELETE CASCADE
    )
  `.execute(database);

  await sql`
    CREATE TABLE app.outbound_use_requests (
      tenant_id text NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
      id text NOT NULL,
      project_id text NOT NULL,
      document_id text NOT NULL,
      job_id text NOT NULL,
      requester_membership_id text NOT NULL,
      provider text NOT NULL,
      model text NOT NULL,
      purpose text NOT NULL,
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'denied', 'consumed', 'closed')),
      approved_by_membership_id text,
      approved_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, id),
      FOREIGN KEY (tenant_id, project_id)
        REFERENCES app.projects(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, requester_membership_id)
        REFERENCES app.memberships(tenant_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id, approved_by_membership_id)
        REFERENCES app.memberships(tenant_id, id) ON DELETE RESTRICT,
      CHECK (
        (status = 'approved' AND approved_by_membership_id IS NOT NULL AND approved_at IS NOT NULL)
        OR status <> 'approved'
      )
    )
  `.execute(database);

  await sql`
    CREATE TABLE app.tenant_model_budgets (
      tenant_id text NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
      provider text NOT NULL,
      model text NOT NULL,
      enabled boolean NOT NULL DEFAULT false,
      monthly_limit_cents integer NOT NULL DEFAULT 0 CHECK (monthly_limit_cents >= 0),
      reserved_cents integer NOT NULL DEFAULT 0 CHECK (reserved_cents >= 0),
      spent_cents integer NOT NULL DEFAULT 0 CHECK (spent_cents >= 0),
      period_start date NOT NULL DEFAULT date_trunc('month', now())::date,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, provider, model),
      CHECK (reserved_cents + spent_cents <= monthly_limit_cents OR monthly_limit_cents = 0)
    )
  `.execute(database);

  await sql`
    CREATE TABLE app.audit_log (
      tenant_id text NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
      id text NOT NULL,
      actor_membership_id text,
      action text NOT NULL,
      resource_type text NOT NULL,
      resource_id text NOT NULL,
      request_id text NOT NULL,
      trace_id text NOT NULL,
      outcome text NOT NULL CHECK (outcome IN ('allowed', 'denied', 'failed')),
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      occurred_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, id),
      FOREIGN KEY (tenant_id, actor_membership_id)
        REFERENCES app.memberships(tenant_id, id) ON DELETE RESTRICT,
      CHECK (jsonb_typeof(metadata) = 'object')
    )
  `.execute(database);

  await sql`
    CREATE TABLE app.legacy_import_runs (
      tenant_id text NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
      id text NOT NULL,
      source_fingerprint text NOT NULL,
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
      imported_companies integer NOT NULL DEFAULT 0 CHECK (imported_companies >= 0),
      imported_projects integer NOT NULL DEFAULT 0 CHECK (imported_projects >= 0),
      error_code text,
      started_at timestamptz,
      finished_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, id),
      UNIQUE (tenant_id, source_fingerprint)
    )
  `.execute(database);

  await enableTenantIsolation(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`DROP SCHEMA IF EXISTS app CASCADE`.execute(database);
}
