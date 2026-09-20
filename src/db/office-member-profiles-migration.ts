import type { DatabaseMigration } from "./migrations";

export const officeMemberProfilesMigration: DatabaseMigration = {
  id: "0040_office_member_profiles",
  upSql: `
    CREATE TABLE office_member_profiles (
      tenant_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      grouping_mode TEXT NOT NULL DEFAULT 'department' CHECK(grouping_mode IN ('department','project')),
      displayed_project_id TEXT,
      description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 160),
      presence_status TEXT NOT NULL DEFAULT 'office' CHECK(presence_status IN ('office','away','trip','custom')),
      custom_status TEXT NOT NULL DEFAULT '' CHECK(length(custom_status) <= 32),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
      PRIMARY KEY(tenant_id,member_id),
      CHECK(presence_status='custom' OR custom_status='')
    );
    CREATE INDEX office_member_profile_project ON office_member_profiles(tenant_id,displayed_project_id);
    INSERT INTO office_department_settings(tenant_id,department_id,grouping_mode)
      SELECT tenant_id,'dept-investment','department' FROM office_department_settings
      WHERE department_id IN ('dept-investment-one','dept-investment-two','dept-new-business')
      GROUP BY tenant_id
      ON CONFLICT(tenant_id,department_id) DO UPDATE SET grouping_mode='department';
    DELETE FROM office_department_settings WHERE department_id IN ('dept-investment-one','dept-investment-two','dept-new-business');
    DELETE FROM office_seats WHERE group_id IN ('department:dept-investment-one','department:dept-investment-two','department:dept-new-business');
  `,
  downSql: "DROP INDEX IF EXISTS office_member_profile_project; DROP TABLE IF EXISTS office_member_profiles;",
};
