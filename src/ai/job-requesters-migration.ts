export const jobAIRequestersMigration = {
  id: "0021_job_ai_requesters",
  upSql: `CREATE TABLE job_ai_requesters (
    job_type TEXT NOT NULL CHECK(job_type IN ('research','discovery','document')),
    job_id TEXT NOT NULL, tenant_id TEXT NOT NULL, account_id TEXT NOT NULL,
    PRIMARY KEY(job_type,job_id)
  ); CREATE INDEX idx_job_ai_requesters_account ON job_ai_requesters(tenant_id,account_id);`,
  downSql: "DROP TABLE IF EXISTS job_ai_requesters;",
};
