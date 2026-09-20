import type { DatabaseMigration } from "./migrations";

/** Additive only: legacy AI candidates remain unchanged and read through a LEFT JOIN. */
export const candidateDetailsMigration: DatabaseMigration = {
  id: "0015_candidate_details",
  upSql: `
    CREATE TABLE candidate_details (
      candidate_id TEXT PRIMARY KEY REFERENCES project_candidates(id) ON DELETE CASCADE,
      import_key TEXT NOT NULL UNIQUE,
      origin TEXT NOT NULL CHECK(origin='manual_screenshot'),
      event_date TEXT,
      round TEXT,
      amount_text TEXT,
      valuation TEXT,
      raw_track TEXT,
      event_type TEXT,
      sources_json TEXT NOT NULL DEFAULT '[]',
      verification_notes TEXT,
      source_screenshot TEXT,
      source_row TEXT,
      raw_input_json TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      imported_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_candidate_details_event_date ON candidate_details(event_date DESC);
  `,
  downSql: `DROP TABLE IF EXISTS candidate_details;`,
};
