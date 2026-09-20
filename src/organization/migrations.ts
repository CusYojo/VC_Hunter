import type { DatabaseSync } from "node:sqlite";

/** Append-only organization migrations, independent of previously deployed auth schema. */
const migrations = [{ version: 1, sql: `
CREATE TABLE organization_departments (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, parent_id TEXT REFERENCES organization_departments(id),
 expected_headcount INTEGER, notes TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE organization_members (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, account_id TEXT UNIQUE REFERENCES user(id), name TEXT NOT NULL,
 title TEXT NOT NULL DEFAULT '', department_id TEXT REFERENCES organization_departments(id), phone TEXT NOT NULL DEFAULT '',
 email TEXT NOT NULL DEFAULT '', wechat TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
 is_placeholder INTEGER NOT NULL DEFAULT 0, source_notes TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
 CHECK((is_placeholder = 1 AND account_id IS NULL) OR (is_placeholder = 0 AND account_id IS NOT NULL))
);
CREATE TABLE organization_audit (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX organization_department_tenant ON organization_departments(tenant_id, sort_order);
CREATE INDEX organization_member_tenant ON organization_members(tenant_id, department_id);
` }, { version: 2, sql: `
INSERT OR IGNORE INTO organization_departments(id,tenant_id,name,parent_id,expected_headcount,notes,sort_order,version)
SELECT 'dept-investment',tenant_id,'投资部',NULL,NULL,'投资一部、投资二部与新业务部合并',2,1
FROM organization_departments
WHERE id IN ('dept-investment-one','dept-investment-two','dept-new-business')
ORDER BY sort_order,id LIMIT 1;
UPDATE organization_departments SET
  name='投资部', sort_order=2,
  expected_headcount=COALESCE(expected_headcount,0)+COALESCE((SELECT SUM(expected_headcount) FROM organization_departments legacy WHERE legacy.tenant_id=organization_departments.tenant_id AND legacy.id IN ('dept-investment-one','dept-investment-two','dept-new-business')),0),
  notes='投资一部、投资二部与新业务部合并'
WHERE id='dept-investment' AND tenant_id=(SELECT tenant_id FROM organization_departments WHERE id IN ('dept-investment-one','dept-investment-two','dept-new-business') LIMIT 1);
UPDATE organization_departments SET parent_id='dept-investment'
WHERE tenant_id=(SELECT tenant_id FROM organization_departments WHERE id='dept-investment') AND parent_id IN ('dept-investment-one','dept-investment-two','dept-new-business');
UPDATE organization_members SET department_id='dept-investment'
WHERE tenant_id=(SELECT tenant_id FROM organization_departments WHERE id='dept-investment') AND department_id IN ('dept-investment-one','dept-investment-two','dept-new-business');
UPDATE organization_departments SET sort_order=CASE id
  WHEN 'dept-headquarters' THEN 1 WHEN 'dept-investment' THEN 2 WHEN 'dept-strategy' THEN 3
  WHEN 'dept-legal' THEN 4 WHEN 'dept-finance' THEN 5 WHEN 'dept-president-office' THEN 6
  WHEN 'dept-risk' THEN 7 WHEN 'dept-fund' THEN 8 WHEN 'dept-saishenggu' THEN 9
  WHEN 'dept-research' THEN 10 WHEN 'branch-ningbo' THEN 11 WHEN 'branch-anhui' THEN 12
  WHEN 'branch-jinhua' THEN 13 WHEN 'branch-overseas' THEN 14 ELSE sort_order END
WHERE tenant_id=(SELECT tenant_id FROM organization_departments WHERE id='dept-investment');
INSERT OR IGNORE INTO organization_audit(id,tenant_id,actor_id,action,target_id,created_at)
SELECT 'organization-department-merge-v2-' || tenant_id,tenant_id,'system:migration','department.investment_merged','dept-investment',unixepoch('now')*1000
FROM organization_departments WHERE id='dept-investment';
DELETE FROM organization_departments
WHERE tenant_id=(SELECT tenant_id FROM organization_departments WHERE id='dept-investment') AND id IN ('dept-investment-one','dept-investment-two','dept-new-business');
` }];

function assertInvestmentMergeTenant(database: DatabaseSync) {
  const legacyTenants = database.prepare(`SELECT DISTINCT tenant_id FROM organization_departments
    WHERE id IN ('dept-investment-one','dept-investment-two','dept-new-business')`).all() as unknown as Array<{ tenant_id: string }>;
  if (legacyTenants.length > 1) throw new Error("投资部门迁移检测到多个租户，已停止合并。");
  if (legacyTenants.length === 0) return;
  const canonical = database.prepare("SELECT tenant_id FROM organization_departments WHERE id='dept-investment'").get() as { tenant_id: string } | undefined;
  if (canonical && canonical.tenant_id !== legacyTenants[0].tenant_id) throw new Error("投资部门迁移检测到租户冲突，已停止合并。");
}

export function migrateOrganization(database: DatabaseSync) {
  database.exec("CREATE TABLE IF NOT EXISTS organization_schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");
  for (const migration of migrations) {
    database.exec("BEGIN IMMEDIATE");
    try {
      if (!database.prepare("SELECT version FROM organization_schema_migrations WHERE version = ?").get(migration.version)) {
        if (migration.version === 2) assertInvestmentMergeTenant(database);
        database.exec(migration.sql);
        database.prepare("INSERT INTO organization_schema_migrations(version, applied_at) VALUES (?, ?)").run(migration.version, Date.now());
      }
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
  }
}
