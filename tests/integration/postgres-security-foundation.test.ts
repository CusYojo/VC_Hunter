import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Kysely, sql } from "kysely";
import { KyselyPGlite } from "kysely-pglite";
import { migratePostgresToLatest } from "@/db/postgres/migrate";

describe("PostgreSQL security foundation", () => {
  let database: Kysely<unknown>;

  beforeEach(async () => {
    const { dialect } = await KyselyPGlite.create();
    database = new Kysely({ dialect });
    await migratePostgresToLatest(database);
  });

  afterEach(async () => {
    await database.destroy();
  });

  it("creates the modular tenant, ACL, policy, budget, audit and import tables", async () => {
    const result = await sql<{ table_name: string }>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'app'
      ORDER BY table_name
    `.execute(database);

    expect(result.rows.map((row) => row.table_name)).toEqual([
      "audit_log",
      "companies",
      "legacy_import_runs",
      "memberships",
      "outbound_use_requests",
      "project_members",
      "projects",
      "tenant_model_budgets",
      "tenants",
    ]);
  });

  it("enables and forces RLS on every tenant-owned table", async () => {
    const result = await sql<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'app'
        AND c.relkind = 'r'
        AND c.relname <> 'tenants'
      ORDER BY c.relname
    `.execute(database);

    expect(result.rows).not.toHaveLength(0);
    expect(result.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
  });

  it("allows the same business id in two tenants and rejects cross-tenant foreign keys", async () => {
    await sql`ALTER TABLE app.memberships DISABLE ROW LEVEL SECURITY`.execute(database);
    await sql`ALTER TABLE app.companies DISABLE ROW LEVEL SECURITY`.execute(database);
    await sql`ALTER TABLE app.projects DISABLE ROW LEVEL SECURITY`.execute(database);
    await sql`ALTER TABLE app.project_members DISABLE ROW LEVEL SECURITY`.execute(database);

    await sql`INSERT INTO app.tenants (id, auth_organization_id, name, slug)
      VALUES ('tenant-a', 'auth-a', 'Tenant A', 'tenant-a'), ('tenant-b', 'auth-b', 'Tenant B', 'tenant-b')`.execute(database);
    await sql`INSERT INTO app.memberships (tenant_id, id, auth_membership_id, user_id, roles)
      VALUES
        ('tenant-a', 'member-1', 'auth-member-a', 'user-a', ARRAY['researcher']),
        ('tenant-b', 'member-1', 'auth-member-b', 'user-b', ARRAY['researcher'])`.execute(database);
    await sql`INSERT INTO app.companies (tenant_id, id, legal_name, aliases, region_scope)
      VALUES
        ('tenant-a', 'company-1', 'Company A', '[]', 'CN-mainland'),
        ('tenant-b', 'company-1', 'Company B', '[]', 'CN-mainland')`.execute(database);
    await sql`INSERT INTO app.projects
      (tenant_id, id, company_id, name, track, subtrack, discovery_at, discovery_reason,
       status, executive_summary, technology_stage, urgency_score, quality_score,
       evidence_quality, signal_type, latest_event_at, risk_flags, open_questions,
       last_researched_at, visibility, owner_member_id)
      VALUES
        ('tenant-a', 'project-1', 'company-1', 'Project A', 'AI', '', now(), 'test',
         'new', '', 'unknown', 0, 0, 0, 'test', now(), '[]', '[]', now(), 'restricted', 'member-1'),
        ('tenant-b', 'project-1', 'company-1', 'Project B', 'AI', '', now(), 'test',
         'new', '', 'unknown', 0, 0, 0, 'test', now(), '[]', '[]', now(), 'restricted', 'member-1')`.execute(database);

    const projects = await sql<{ tenant_id: string; id: string }>`
      SELECT tenant_id, id FROM app.projects ORDER BY tenant_id
    `.execute(database);
    expect(projects.rows).toEqual([
      { tenant_id: "tenant-a", id: "project-1" },
      { tenant_id: "tenant-b", id: "project-1" },
    ]);

    await expect(sql`INSERT INTO app.project_members (tenant_id, project_id, membership_id)
      VALUES ('tenant-a', 'project-1', 'missing-member')`.execute(database)).rejects.toThrow();
  });

  it("defaults every provider budget to disabled and zero", async () => {
    await sql`ALTER TABLE app.tenant_model_budgets DISABLE ROW LEVEL SECURITY`.execute(database);
    await sql`INSERT INTO app.tenants (id, auth_organization_id, name, slug)
      VALUES ('tenant-a', 'auth-a', 'Tenant A', 'tenant-a')`.execute(database);
    await sql`INSERT INTO app.tenant_model_budgets (tenant_id, provider, model)
      VALUES ('tenant-a', 'deepseek', 'deepseek-chat')`.execute(database);
    const result = await sql<{ enabled: boolean; monthly_limit_cents: number; reserved_cents: number; spent_cents: number }>`
      SELECT enabled, monthly_limit_cents, reserved_cents, spent_cents
      FROM app.tenant_model_budgets
      WHERE tenant_id = 'tenant-a'
    `.execute(database);
    expect(result.rows[0]).toEqual({
      enabled: false,
      monthly_limit_cents: 0,
      reserved_cents: 0,
      spent_cents: 0,
    });
  });

  it("rejects empty or unknown organization roles at the database boundary", async () => {
    await sql`ALTER TABLE app.memberships DISABLE ROW LEVEL SECURITY`.execute(database);
    await sql`INSERT INTO app.tenants (id, auth_organization_id, name, slug)
      VALUES ('tenant-a', 'auth-a', 'Tenant A', 'tenant-a')`.execute(database);

    await expect(sql`INSERT INTO app.memberships
      (tenant_id, id, auth_membership_id, user_id, roles)
      VALUES ('tenant-a', 'member-empty', 'auth-empty', 'user-empty', ARRAY[]::text[])`
      .execute(database)).rejects.toThrow();
    await expect(sql`INSERT INTO app.memberships
      (tenant_id, id, auth_membership_id, user_id, roles)
      VALUES ('tenant-a', 'member-admin', 'auth-admin', 'user-admin', ARRAY['invented-admin'])`
      .execute(database)).rejects.toThrow();
  });

  it("never allows reserved and spent model cost to exceed the monthly limit", async () => {
    await sql`ALTER TABLE app.tenant_model_budgets DISABLE ROW LEVEL SECURITY`.execute(database);
    await sql`INSERT INTO app.tenants (id, auth_organization_id, name, slug)
      VALUES ('tenant-a', 'auth-a', 'Tenant A', 'tenant-a')`.execute(database);
    await sql`INSERT INTO app.tenant_model_budgets
      (tenant_id, provider, model, monthly_limit_cents)
      VALUES ('tenant-a', 'deepseek', 'deepseek-chat', 100)`.execute(database);

    await expect(sql`UPDATE app.tenant_model_budgets
      SET reserved_cents = 80, spent_cents = 21
      WHERE tenant_id = 'tenant-a' AND provider = 'deepseek' AND model = 'deepseek-chat'`
      .execute(database)).rejects.toThrow();
  });
});
