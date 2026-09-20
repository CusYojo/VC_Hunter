import type { DatabaseMigration } from "./migrations";

export const organizationOfficeMigration: DatabaseMigration = {
  id: "0034_organization_office",
  upSql: `
    CREATE TABLE office_layouts (tenant_id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE office_department_settings (
      tenant_id TEXT NOT NULL, department_id TEXT NOT NULL, grouping_mode TEXT NOT NULL CHECK(grouping_mode IN ('project','department')),
      PRIMARY KEY(tenant_id,department_id)
    );
    CREATE TABLE office_member_styles (
      tenant_id TEXT NOT NULL, member_id TEXT NOT NULL, desk_color TEXT NOT NULL DEFAULT '#b98758',
      desk_shape TEXT NOT NULL DEFAULT 'classic' CHECK(desk_shape IN ('classic','corner','round')),
      approved_avatar_id TEXT, version INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(tenant_id,member_id)
    );
    CREATE TABLE office_seats (
      tenant_id TEXT NOT NULL, group_id TEXT NOT NULL, member_id TEXT NOT NULL, x INTEGER NOT NULL CHECK(x BETWEEN 0 AND 31),
      y INTEGER NOT NULL CHECK(y BETWEEN 0 AND 127), PRIMARY KEY(tenant_id,group_id,member_id)
    );
    CREATE TABLE office_avatar_submissions (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, member_id TEXT NOT NULL, png_content BLOB NOT NULL,
      width INTEGER NOT NULL DEFAULT 32 CHECK(width=32), height INTEGER NOT NULL DEFAULT 48 CHECK(height=48),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      review_note TEXT NOT NULL DEFAULT '', reviewed_by TEXT, reviewed_at TEXT, created_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1, CHECK(length(png_content) BETWEEN 1 AND 262144)
    );
    CREATE INDEX office_avatar_member ON office_avatar_submissions(tenant_id,member_id,created_at);
    CREATE INDEX office_avatar_review ON office_avatar_submissions(tenant_id,status,created_at);
    CREATE TABLE office_audit (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL,
      target_id TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `,
  downSql: "DROP TABLE office_audit; DROP TABLE office_avatar_submissions; DROP TABLE office_seats; DROP TABLE office_member_styles; DROP TABLE office_department_settings; DROP TABLE office_layouts;",
};
