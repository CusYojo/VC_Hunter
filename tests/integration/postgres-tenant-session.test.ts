import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Kysely, sql } from "kysely";
import { KyselyPGlite } from "kysely-pglite";
import { migratePostgresToLatest } from "@/db/postgres/migrate";
import { runInTenantTransaction } from "@/db/postgres/tenant-transaction";

describe("PostgreSQL tenant transaction", () => {
  let database: Kysely<unknown>;

  beforeEach(async () => {
    const { dialect } = await KyselyPGlite.create();
    database = new Kysely({ dialect });
    await migratePostgresToLatest(database);
    await sql`ALTER TABLE app.memberships DISABLE ROW LEVEL SECURITY`.execute(database);
    await sql`ALTER TABLE app.companies DISABLE ROW LEVEL SECURITY`.execute(database);
    await sql`ALTER TABLE app.projects DISABLE ROW LEVEL SECURITY`.execute(database);
    await sql`INSERT INTO app.tenants (id, auth_organization_id, name, slug)
      VALUES ('tenant-a', 'auth-a', 'Tenant A', 'tenant-a'),
             ('tenant-b', 'auth-b', 'Tenant B', 'tenant-b')`.execute(database);
    await sql`INSERT INTO app.memberships (tenant_id, id, auth_membership_id, user_id, roles)
      VALUES ('tenant-a', 'member-a', 'auth-member-a', 'user-a', ARRAY['researcher']),
             ('tenant-b', 'member-b', 'auth-member-b', 'user-b', ARRAY['researcher'])`.execute(database);
    await sql`INSERT INTO app.companies (tenant_id, id, legal_name, aliases, region_scope)
      VALUES ('tenant-a', 'company-a', 'Company A', '[]', 'CN-mainland'),
             ('tenant-b', 'company-b', 'Company B', '[]', 'CN-mainland')`.execute(database);
    await sql`INSERT INTO app.projects
      (tenant_id, id, company_id, name, track, subtrack, discovery_at, discovery_reason,
       status, executive_summary, technology_stage, urgency_score, quality_score,
       evidence_quality, signal_type, latest_event_at, risk_flags, open_questions,
       last_researched_at, visibility, owner_member_id)
      VALUES
        ('tenant-a', 'project-a', 'company-a', 'Project A', 'AI', '', now(), 'test',
         'new', '', 'unknown', 0, 0, 0, 'test', now(), '[]', '[]', now(), 'tenant', 'member-a'),
        ('tenant-b', 'project-b', 'company-b', 'Project B', 'AI', '', now(), 'test',
         'new', '', 'unknown', 0, 0, 0, 'test', now(), '[]', '[]', now(), 'tenant', 'member-b')`
      .execute(database);
    await sql`ALTER TABLE app.memberships ENABLE ROW LEVEL SECURITY`.execute(database);
    await sql`ALTER TABLE app.companies ENABLE ROW LEVEL SECURITY`.execute(database);
    await sql`ALTER TABLE app.projects ENABLE ROW LEVEL SECURITY`.execute(database);
    await sql`CREATE ROLE app_runtime NOLOGIN`.execute(database);
    await sql`GRANT USAGE ON SCHEMA app TO app_runtime`.execute(database);
    await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_runtime`
      .execute(database);
    await sql`SET ROLE app_runtime`.execute(database);
  });

  afterEach(async () => {
    await sql`RESET ROLE`.execute(database);
    await database.destroy();
  });

  it("filters reads to the server-selected tenant", async () => {
    const tenantAProjects = await runInTenantTransaction(database, "tenant-a", async (transaction) => {
      const result = await sql<{ id: string; tenant_id: string }>`
        SELECT id, tenant_id FROM app.projects ORDER BY id
      `.execute(transaction);
      return result.rows;
    });

    expect(tenantAProjects).toEqual([{ id: "project-a", tenant_id: "tenant-a" }]);
  });

  it("rejects writes whose tenant does not match the transaction context", async () => {
    await expect(runInTenantTransaction(database, "tenant-a", async (transaction) => {
      await sql`INSERT INTO app.companies
        (tenant_id, id, legal_name, aliases, region_scope)
        VALUES ('tenant-b', 'company-injected', 'Injected', '[]', 'CN-mainland')`
        .execute(transaction);
    })).rejects.toThrow();
  });

  it("does not leak tenant context after the transaction completes", async () => {
    await runInTenantTransaction(database, "tenant-a", async (transaction) => {
      const result = await sql<{ tenant_id: string }>`SELECT tenant_id FROM app.projects`
        .execute(transaction);
      expect(result.rows).toHaveLength(1);
    });

    const outsideTransaction = await sql<{ tenant_id: string }>`SELECT tenant_id FROM app.projects`
      .execute(database);
    expect(outsideTransaction.rows).toEqual([]);
  });

  it.each(["", "   ", "tenant\nother"])("rejects invalid tenant identifiers: %j", async (tenantId) => {
    await expect(runInTenantTransaction(database, tenantId, async () => undefined)).rejects.toThrow(
      /tenant identifier/i,
    );
  });
});
