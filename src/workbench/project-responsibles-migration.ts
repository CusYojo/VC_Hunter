export const projectResponsiblesMigration = {
  id: "0025_project_responsibles",
  upSql: `CREATE TABLE project_responsibles (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    member_name TEXT NOT NULL, member_id TEXT, position INTEGER NOT NULL,
    assigned_at TEXT NOT NULL, PRIMARY KEY(project_id,member_name), UNIQUE(project_id,position)
  );
  INSERT INTO project_responsibles(project_id,member_name,member_id,position,assigned_at)
    SELECT id,owner,NULL,0,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM projects WHERE owner IS NOT NULL AND trim(owner)<>'';`,
  downSql: "DROP TABLE IF EXISTS project_responsibles;",
};
