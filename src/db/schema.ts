export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  authority TEXT NOT NULL CHECK (authority IN ('A','B','C','D')),
  access_mode TEXT NOT NULL,
  robots_status TEXT NOT NULL,
  license_notes TEXT NOT NULL,
  policy_status TEXT NOT NULL CHECK (policy_status IN ('approved','manual_only','blocked')),
  independent_group TEXT NOT NULL,
  last_checked_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  canonical_url TEXT NOT NULL,
  title TEXT NOT NULL,
  published_at TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  raw_excerpt TEXT NOT NULL,
  UNIQUE(source_id, content_hash)
);

CREATE TABLE IF NOT EXISTS evidence_fragments (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  quoted_context TEXT NOT NULL,
  fragment_hash TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  legal_name TEXT NOT NULL,
  aliases_json TEXT NOT NULL,
  official_domain TEXT,
  region_scope TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  track TEXT NOT NULL,
  subtrack TEXT NOT NULL,
  discovery_at TEXT NOT NULL,
  discovery_reason TEXT NOT NULL,
  status TEXT NOT NULL,
  executive_summary TEXT NOT NULL,
  technology_stage TEXT NOT NULL,
  urgency_score INTEGER NOT NULL,
  quality_score INTEGER NOT NULL,
  evidence_quality REAL NOT NULL,
  owner TEXT,
  signal_type TEXT NOT NULL,
  latest_event_at TEXT NOT NULL,
  risk_flags_json TEXT NOT NULL,
  open_questions_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_researched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assertions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  predicate TEXT NOT NULL,
  label TEXT NOT NULL,
  value_status TEXT NOT NULL,
  epistemic_type TEXT NOT NULL,
  value_json TEXT,
  unit TEXT,
  null_reason TEXT,
  confidence REAL NOT NULL,
  extraction_method TEXT NOT NULL,
  model_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','disputed','superseded','retracted')),
  valid_from TEXT,
  valid_to TEXT
);

CREATE TABLE IF NOT EXISTS assertion_evidence (
  assertion_id TEXT NOT NULL REFERENCES assertions(id),
  evidence_id TEXT NOT NULL REFERENCES evidence_fragments(id),
  relation TEXT NOT NULL CHECK (relation IN ('supports','contradicts')),
  PRIMARY KEY(assertion_id, evidence_id)
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  confidence REAL NOT NULL,
  evidence_id TEXT NOT NULL REFERENCES evidence_fragments(id)
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  event_id TEXT REFERENCES events(id),
  severity TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_cards (
  id TEXT PRIMARY KEY,
  track TEXT NOT NULL UNIQUE,
  definition TEXT NOT NULL,
  routes_json TEXT NOT NULL,
  milestones_json TEXT NOT NULL,
  keywords_json TEXT NOT NULL,
  query_templates_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  note TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS research_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_projects_track_status ON projects(track, status);
CREATE INDEX IF NOT EXISTS idx_assertions_project ON assertions(project_id);
CREATE INDEX IF NOT EXISTS idx_events_project_time ON events(project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_log(resource_type, resource_id, created_at DESC);
`;
