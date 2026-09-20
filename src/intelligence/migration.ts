import type { DatabaseMigration } from "@/db/migrations";

export const intelligenceDiscoveryMigration: DatabaseMigration = {
  id: "0043_intelligence_discovery",
  upSql: `
    ALTER TABLE sources ADD COLUMN channel TEXT NOT NULL DEFAULT 'legacy';
    ALTER TABLE sources ADD COLUMN connector_type TEXT NOT NULL DEFAULT 'legacy';
    ALTER TABLE sources ADD COLUMN access_class TEXT NOT NULL DEFAULT 'public';
    ALTER TABLE sources ADD COLUMN allowed_storage TEXT NOT NULL DEFAULT 'metadata_excerpt';
    ALTER TABLE sources ADD COLUMN allow_external_model INTEGER NOT NULL DEFAULT 0 CHECK (allow_external_model IN (0,1));
    ALTER TABLE sources ADD COLUMN frequency_limit TEXT;
    ALTER TABLE sources ADD COLUMN terms_review_status TEXT NOT NULL DEFAULT 'pending';
    ALTER TABLE sources ADD COLUMN credential_ref TEXT;
    CREATE TABLE intelligence_candidates (
      id TEXT PRIMARY KEY,
      legacy_project_candidate_id TEXT UNIQUE REFERENCES project_candidates(id),
      import_batch_id TEXT,
      external_id TEXT,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('company','person','technology')),
      candidate_kind TEXT NOT NULL CHECK(candidate_kind IN ('new_entity','entity_update')),
      subject_name TEXT NOT NULL,
      track TEXT NOT NULL,
      subtrack TEXT,
      city TEXT,
      signal_type TEXT NOT NULL,
      event_date TEXT NOT NULL,
      source_channel TEXT NOT NULL CHECK(source_channel IN ('venture_tech','registry','hiring','ranking_award','manual_codex')),
      discovery_reason TEXT NOT NULL,
      investment_summary TEXT NOT NULL DEFAULT '',
      investment_highlights_json TEXT NOT NULL DEFAULT '[]',
      priority_band TEXT NOT NULL CHECK(priority_band IN ('A','B','C')),
      scores_json TEXT NOT NULL,
      completeness_level TEXT NOT NULL CHECK(completeness_level IN ('L0','L1','L2')),
      open_questions_json TEXT NOT NULL DEFAULT '[]',
      missing_fields_json TEXT NOT NULL DEFAULT '[]',
      matched_entity_type TEXT,
      matched_entity_id TEXT,
      match_confidence REAL,
      match_reason TEXT,
      status TEXT NOT NULL CHECK(status IN ('pending_review','promoted','dismissed','merged')),
      review_version INTEGER NOT NULL DEFAULT 1,
      reviewed_by TEXT,
      reviewed_at TEXT,
      review_reason TEXT,
      promoted_entity_id TEXT,
      details_json TEXT NOT NULL DEFAULT '{}',
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(import_batch_id,external_id)
    );
    CREATE INDEX idx_intelligence_candidates_queue ON intelligence_candidates(status,priority_band,event_date DESC);
    CREATE INDEX idx_intelligence_candidates_filters ON intelligence_candidates(entity_type,source_channel,city,track,completeness_level);
    CREATE INDEX idx_intelligence_candidates_match ON intelligence_candidates(matched_entity_type,matched_entity_id);

    CREATE TABLE intelligence_candidate_sources (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES intelligence_candidates(id) ON DELETE CASCADE,
      source_ref TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      published_at TEXT,
      observed_at TEXT NOT NULL,
      excerpt TEXT NOT NULL,
      authority TEXT NOT NULL CHECK(authority IN ('A','B','C','D')),
      access_class TEXT NOT NULL CHECK(access_class IN ('public','licensed_internal','user_supplied')),
      collection_method TEXT NOT NULL CHECK(collection_method IN ('web_search','rss','api','codex','manual_upload','legacy')),
      allow_external_model INTEGER NOT NULL CHECK(allow_external_model IN (0,1)),
      content_hash TEXT NOT NULL,
      canonical_evidence_id TEXT,
      UNIQUE(candidate_id,source_ref),
      UNIQUE(candidate_id,url,content_hash)
    );

    CREATE TABLE intelligence_candidate_assertions (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES intelligence_candidates(id) ON DELETE CASCADE,
      field_key TEXT NOT NULL,
      label TEXT NOT NULL,
      value_status TEXT NOT NULL CHECK(value_status IN ('known','unknown','not_disclosed','estimated')),
      epistemic_type TEXT NOT NULL CHECK(epistemic_type IN ('fact','inference','opinion')),
      value_json TEXT,
      unit TEXT,
      confidence REAL NOT NULL,
      evidence_refs_json TEXT NOT NULL,
      UNIQUE(candidate_id,field_key,label)
    );

    CREATE TABLE intelligence_candidate_relationships (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES intelligence_candidates(id) ON DELETE CASCADE,
      related_entity_type TEXT NOT NULL CHECK(related_entity_type IN ('company','person','technology')),
      related_entity_id TEXT,
      related_name TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      confidence REAL NOT NULL,
      evidence_refs_json TEXT NOT NULL
    );

    CREATE TABLE intelligence_candidate_contacts (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES intelligence_candidates(id) ON DELETE CASCADE,
      contact_type TEXT NOT NULL CHECK(contact_type IN ('work_email','work_phone','website_contact','public_profile')),
      contact_value TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      verified_at TEXT NOT NULL
    );

    CREATE TABLE discovery_import_batches (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      schema_version TEXT NOT NULL,
      source_batch_id TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      payload_bytes INTEGER NOT NULL,
      original_json TEXT NOT NULL,
      preview_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('previewed','committed','failed')),
      version INTEGER NOT NULL DEFAULT 1,
      commit_result_json TEXT,
      created_at TEXT NOT NULL,
      committed_at TEXT,
      UNIQUE(tenant_id,actor_id,idempotency_key)
    );

    CREATE TABLE discovery_review_requests (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES intelligence_candidates(id),
      actor_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(actor_id,idempotency_key)
    );

    CREATE TABLE company_profiles (
      company_id TEXT PRIMARY KEY REFERENCES companies(id),
      registered_address TEXT,
      research_locations_json TEXT NOT NULL DEFAULT '[]',
      business_scope TEXT,
      products_json TEXT NOT NULL DEFAULT '[]',
      core_technologies_json TEXT NOT NULL DEFAULT '[]',
      competitors_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE person_profile_details (
      person_id TEXT PRIMARY KEY REFERENCES people(id),
      education_json TEXT NOT NULL DEFAULT '[]',
      employment_json TEXT NOT NULL DEFAULT '[]',
      technical_background TEXT,
      publications_json TEXT NOT NULL DEFAULT '[]',
      patents_json TEXT NOT NULL DEFAULT '[]',
      homepage TEXT,
      reports_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE technologies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      track TEXT NOT NULL,
      subtrack TEXT,
      definition TEXT NOT NULL,
      maturity TEXT NOT NULL CHECK(maturity IN ('concept','laboratory','engineering_validation','pilot','commercial','unknown')),
      key_metrics_json TEXT NOT NULL DEFAULT '[]',
      papers_json TEXT NOT NULL DEFAULT '[]',
      patents_json TEXT NOT NULL DEFAULT '[]',
      alternatives_json TEXT NOT NULL DEFAULT '[]',
      competitors_json TEXT NOT NULL DEFAULT '[]',
      investment_summary TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_technologies_track ON technologies(track,subtrack,name);

    CREATE TABLE entity_assertions (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('company','person','technology')),
      entity_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL REFERENCES intelligence_candidates(id),
      field_key TEXT NOT NULL,
      label TEXT NOT NULL,
      value_status TEXT NOT NULL CHECK(value_status IN ('known','unknown','not_disclosed','estimated')),
      epistemic_type TEXT NOT NULL CHECK(epistemic_type IN ('fact','inference','opinion')),
      value_json TEXT,
      unit TEXT,
      confidence REAL NOT NULL,
      evidence_ids_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_entity_assertions_entity ON entity_assertions(entity_type,entity_id,created_at DESC);

    CREATE TABLE entity_relationships (
      id TEXT PRIMARY KEY,
      source_entity_type TEXT NOT NULL CHECK(source_entity_type IN ('company','person','technology')),
      source_entity_id TEXT NOT NULL,
      target_entity_type TEXT NOT NULL CHECK(target_entity_type IN ('company','person','technology')),
      target_entity_id TEXT,
      target_name TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      confidence REAL NOT NULL,
      candidate_id TEXT NOT NULL REFERENCES intelligence_candidates(id),
      evidence_ids_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_entity_relationships_source ON entity_relationships(source_entity_type,source_entity_id,relation_type);

    CREATE TABLE entity_public_contacts (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('company','person')),
      entity_id TEXT NOT NULL,
      contact_type TEXT NOT NULL CHECK(contact_type IN ('work_email','work_phone','website_contact','public_profile')),
      contact_value TEXT NOT NULL,
      source_url TEXT NOT NULL,
      verified_at TEXT NOT NULL,
      public_basis TEXT NOT NULL CHECK(public_basis='public_work_contact'),
      created_at TEXT NOT NULL,
      UNIQUE(entity_type,entity_id,contact_type,contact_value)
    );

    CREATE TABLE entity_intelligence_events (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('company','person','technology')),
      entity_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL UNIQUE REFERENCES intelligence_candidates(id),
      signal_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      summary TEXT NOT NULL,
      evidence_ids_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE intelligence_research_tasks (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES intelligence_candidates(id),
      entity_type TEXT NOT NULL CHECK(entity_type IN ('company','person','technology')),
      entity_id TEXT,
      field_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('open','completed','dismissed')),
      created_at TEXT NOT NULL,
      UNIQUE(candidate_id,field_key)
    );

    CREATE TABLE discovery_plans_v2 (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      channel TEXT NOT NULL CHECK(channel IN ('venture_tech','registry','hiring','ranking_award')),
      query_family TEXT NOT NULL,
      tracks_json TEXT NOT NULL,
      subtracks_json TEXT NOT NULL,
      cities_json TEXT NOT NULL,
      preferred_domains_json TEXT NOT NULL,
      date_window_days INTEGER NOT NULL CHECK(date_window_days BETWEEN 1 AND 365),
      connector_type TEXT NOT NULL CHECK(connector_type IN ('public_search','rss','licensed_api')),
      enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
      schedule_json TEXT NOT NULL,
      next_run_at TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      updated_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE discovery_digests (
      id TEXT PRIMARY KEY,
      digest_date TEXT NOT NULL UNIQUE,
      summary TEXT NOT NULL,
      candidate_ids_json TEXT NOT NULL,
      recipient_roles_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('draft','published')),
      created_at TEXT NOT NULL,
      published_at TEXT
    );
  `,
  downSql: `
    DROP TABLE IF EXISTS discovery_digests;
    DROP TABLE IF EXISTS discovery_plans_v2;
    DROP TABLE IF EXISTS intelligence_research_tasks;
    DROP TABLE IF EXISTS entity_intelligence_events;
    DROP TABLE IF EXISTS entity_public_contacts;
    DROP TABLE IF EXISTS entity_relationships;
    DROP TABLE IF EXISTS entity_assertions;
    DROP TABLE IF EXISTS technologies;
    DROP TABLE IF EXISTS person_profile_details;
    DROP TABLE IF EXISTS company_profiles;
    DROP TABLE IF EXISTS discovery_review_requests;
    DROP TABLE IF EXISTS discovery_import_batches;
    DROP TABLE IF EXISTS intelligence_candidate_contacts;
    DROP TABLE IF EXISTS intelligence_candidate_relationships;
    DROP TABLE IF EXISTS intelligence_candidate_assertions;
    DROP TABLE IF EXISTS intelligence_candidate_sources;
    DROP TABLE IF EXISTS intelligence_candidates;
  `,
};

/** Data-only migration kept separate from the additive schema migration. */
export const intelligenceLegacyBackfillMigration: DatabaseMigration = {
  id: "0044_intelligence_legacy_backfill",
  upSql: `
    INSERT OR IGNORE INTO intelligence_candidates(
      id,legacy_project_candidate_id,entity_type,candidate_kind,subject_name,track,subtrack,city,signal_type,event_date,
      source_channel,discovery_reason,investment_summary,priority_band,scores_json,completeness_level,content_hash,status,
      review_version,reviewed_by,reviewed_at,review_reason,promoted_entity_id,created_at,updated_at
    )
    SELECT pc.id,pc.id,'company','new_entity',pc.company_name,pc.track,NULL,NULL,pc.signal_type,substr(pc.created_at,1,10),
      'venture_tech',pc.summary,pc.summary,'C','{"technology":1,"team":1,"commercial":1,"signal":1,"evidence":1}',
      'L0','legacy:' || pc.id,pc.status,COALESCE(pc.review_version,1),pc.reviewed_by,pc.reviewed_at,pc.review_reason,
      (SELECT p.company_id FROM projects p WHERE p.id=pc.promoted_project_id),pc.created_at,pc.updated_at
    FROM project_candidates pc;
    INSERT OR IGNORE INTO intelligence_candidate_sources(
      id,candidate_id,source_ref,title,url,published_at,observed_at,excerpt,authority,access_class,collection_method,allow_external_model,content_hash
    ) SELECT pc.id || ':source',pc.id,'legacy-lead',w.title,w.url,w.published_at,COALESCE(w.first_seen_at,pc.created_at),pc.summary,'C','public','legacy',0,'legacy-source:' || pc.id
      FROM project_candidates pc JOIN web_search_leads w ON w.id=pc.lead_id;
  `,
  downSql: "DELETE FROM intelligence_candidates WHERE legacy_project_candidate_id IS NOT NULL;",
};

export const intelligenceOperationsMigration: DatabaseMigration = {
  id: "0045_intelligence_operations",
  upSql: `
    ALTER TABLE discovery_plans_v2 ADD COLUMN lease_owner TEXT;
    ALTER TABLE discovery_plans_v2 ADD COLUMN lease_until TEXT;
    ALTER TABLE discovery_plans_v2 ADD COLUMN last_started_at TEXT;
    ALTER TABLE discovery_plans_v2 ADD COLUMN last_finished_at TEXT;
    ALTER TABLE discovery_plans_v2 ADD COLUMN last_status TEXT;
    ALTER TABLE discovery_plans_v2 ADD COLUMN last_error_code TEXT;
    ALTER TABLE discovery_plans_v2 ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
    CREATE INDEX idx_discovery_plans_v2_due ON discovery_plans_v2(enabled,next_run_at,lease_until);

    CREATE TRIGGER intelligence_legacy_candidate_insert AFTER INSERT ON project_candidates
    BEGIN
      INSERT OR IGNORE INTO intelligence_candidates(
        id,legacy_project_candidate_id,entity_type,candidate_kind,subject_name,track,signal_type,event_date,source_channel,
        discovery_reason,investment_summary,investment_highlights_json,priority_band,scores_json,completeness_level,
        open_questions_json,missing_fields_json,status,review_version,promoted_entity_id,details_json,content_hash,created_at,updated_at
      ) VALUES(
        NEW.id,NEW.id,'company','new_entity',NEW.company_name,NEW.track,NEW.signal_type,
        COALESCE((SELECT substr(published_at,1,10) FROM web_search_leads WHERE id=NEW.lead_id),substr(NEW.created_at,1,10)),
        'venture_tech',NEW.summary,NEW.summary,'[]','C','{"technology":1,"team":1,"commercial":1,"signal":1,"evidence":1}',
        'L0','[]','[]',NEW.status,COALESCE(NEW.review_version,1),(SELECT p.company_id FROM projects p WHERE p.id=NEW.promoted_project_id),'{}','legacy:' || NEW.id,NEW.created_at,NEW.updated_at
      );
      INSERT OR IGNORE INTO intelligence_candidate_sources(
        id,candidate_id,source_ref,title,url,published_at,observed_at,excerpt,authority,access_class,collection_method,allow_external_model,content_hash
      ) SELECT NEW.id || ':source',NEW.id,'legacy-lead',title,url,published_at,NEW.created_at,NEW.summary,'C','public','web_search',0,'legacy-source:' || NEW.id
        FROM web_search_leads WHERE id=NEW.lead_id;
    END;

    CREATE TRIGGER intelligence_legacy_candidate_update AFTER UPDATE OF status,review_version,reviewed_by,reviewed_at,review_reason,promoted_project_id,summary,track ON project_candidates
    BEGIN
      UPDATE intelligence_candidates SET status=NEW.status,review_version=COALESCE(NEW.review_version,review_version),reviewed_by=NEW.reviewed_by,
        reviewed_at=NEW.reviewed_at,review_reason=NEW.review_reason,promoted_entity_id=(SELECT p.company_id FROM projects p WHERE p.id=NEW.promoted_project_id),investment_summary=NEW.summary,
        track=NEW.track,updated_at=NEW.updated_at WHERE legacy_project_candidate_id=NEW.id;
    END;

    CREATE TABLE member_notifications_intelligence (
      id TEXT PRIMARY KEY, recipient_id TEXT NOT NULL, actor_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('mention','milestone_assigned','project_assigned','task_assigned','activity_invited','approval_requested','approval_decided','activity_updated','activity_responded','activity_comment','project_comment','document_comment','document_reviewed','project_created','discovery_digest')),
      project_id TEXT REFERENCES projects(id), milestone_id TEXT, comment_id TEXT,
      message TEXT NOT NULL, target_url TEXT NOT NULL DEFAULT '/work', read_at TEXT, created_at TEXT NOT NULL
    );
    INSERT INTO member_notifications_intelligence SELECT * FROM member_notifications;
    DROP TABLE member_notifications;
    ALTER TABLE member_notifications_intelligence RENAME TO member_notifications;
    CREATE INDEX idx_member_notifications_inbox ON member_notifications(recipient_id,read_at,created_at);
  `,
  downSql: `
    DROP TRIGGER IF EXISTS intelligence_legacy_candidate_update;
    DROP TRIGGER IF EXISTS intelligence_legacy_candidate_insert;
    DROP INDEX IF EXISTS idx_discovery_plans_v2_due;
    ALTER TABLE discovery_plans_v2 DROP COLUMN last_error_code;
    ALTER TABLE discovery_plans_v2 DROP COLUMN consecutive_failures;
    ALTER TABLE discovery_plans_v2 DROP COLUMN last_status;
    ALTER TABLE discovery_plans_v2 DROP COLUMN last_finished_at;
    ALTER TABLE discovery_plans_v2 DROP COLUMN last_started_at;
    ALTER TABLE discovery_plans_v2 DROP COLUMN lease_until;
    ALTER TABLE discovery_plans_v2 DROP COLUMN lease_owner;
  `,
};

/** Kept separate so installations that already ran 0043 still receive valuation support. */
export const intelligenceInvestmentValuationMigration: DatabaseMigration = {
  id: "0046_intelligence_investment_valuation",
  upSql: "ALTER TABLE investment_events ADD COLUMN valuation INTEGER;",
  downSql: "ALTER TABLE investment_events DROP COLUMN valuation;",
};

/** Corrects legacy entity semantics and adds privacy/audit controls for staged imports and contacts. */
export const intelligenceHardeningMigration: DatabaseMigration = {
  id: "0047_intelligence_hardening",
  upSql: `
    ALTER TABLE discovery_import_batches ADD COLUMN expires_at TEXT;
    ALTER TABLE entity_public_contacts ADD COLUMN evidence_id TEXT;
    ALTER TABLE entity_public_contacts ADD COLUMN reviewed_by TEXT;
    ALTER TABLE entity_public_contacts ADD COLUMN review_candidate_id TEXT;
    UPDATE discovery_import_batches SET expires_at=datetime(created_at,'+1 day') WHERE status='previewed' AND expires_at IS NULL;
    UPDATE intelligence_candidates SET promoted_entity_id=(
      SELECT p.company_id FROM project_candidates pc JOIN projects p ON p.id=pc.promoted_project_id
      WHERE pc.id=intelligence_candidates.legacy_project_candidate_id
    ) WHERE legacy_project_candidate_id IS NOT NULL AND EXISTS(
      SELECT 1 FROM project_candidates pc JOIN projects p ON p.id=pc.promoted_project_id
      WHERE pc.id=intelligence_candidates.legacy_project_candidate_id
    );
    INSERT OR IGNORE INTO intelligence_candidate_sources(
      id,candidate_id,source_ref,title,url,published_at,observed_at,excerpt,authority,access_class,collection_method,allow_external_model,content_hash
    ) SELECT pc.id || ':source',pc.id,'legacy-lead',w.title,w.url,w.published_at,COALESCE(w.first_seen_at,pc.created_at),pc.summary,'C','public','legacy',0,'legacy-source:' || pc.id
      FROM project_candidates pc JOIN web_search_leads w ON w.id=pc.lead_id JOIN intelligence_candidates i ON i.legacy_project_candidate_id=pc.id;
    DROP TRIGGER IF EXISTS intelligence_legacy_candidate_insert;
    CREATE TRIGGER intelligence_legacy_candidate_insert AFTER INSERT ON project_candidates
    BEGIN
      INSERT OR IGNORE INTO intelligence_candidates(
        id,legacy_project_candidate_id,entity_type,candidate_kind,subject_name,track,signal_type,event_date,source_channel,
        discovery_reason,investment_summary,investment_highlights_json,priority_band,scores_json,completeness_level,
        open_questions_json,missing_fields_json,status,review_version,promoted_entity_id,details_json,content_hash,created_at,updated_at
      ) VALUES(
        NEW.id,NEW.id,'company','new_entity',NEW.company_name,NEW.track,NEW.signal_type,
        COALESCE((SELECT substr(published_at,1,10) FROM web_search_leads WHERE id=NEW.lead_id),substr(NEW.created_at,1,10)),
        'venture_tech',NEW.summary,NEW.summary,'[]','C','{"technology":1,"team":1,"commercial":1,"signal":1,"evidence":1}',
        'L0','[]','[]',NEW.status,COALESCE(NEW.review_version,1),(SELECT p.company_id FROM projects p WHERE p.id=NEW.promoted_project_id),'{}','legacy:' || NEW.id,NEW.created_at,NEW.updated_at
      );
      INSERT OR IGNORE INTO intelligence_candidate_sources(
        id,candidate_id,source_ref,title,url,published_at,observed_at,excerpt,authority,access_class,collection_method,allow_external_model,content_hash
      ) SELECT NEW.id || ':source',NEW.id,'legacy-lead',title,url,published_at,NEW.created_at,NEW.summary,'C','public','legacy',0,'legacy-source:' || NEW.id
        FROM web_search_leads WHERE id=NEW.lead_id;
    END;
    DROP TRIGGER IF EXISTS intelligence_legacy_candidate_update;
    CREATE TRIGGER intelligence_legacy_candidate_update AFTER UPDATE OF status,review_version,reviewed_by,reviewed_at,review_reason,promoted_project_id,summary,track ON project_candidates
    BEGIN
      UPDATE intelligence_candidates SET status=NEW.status,review_version=COALESCE(NEW.review_version,review_version),reviewed_by=NEW.reviewed_by,
        reviewed_at=NEW.reviewed_at,review_reason=NEW.review_reason,promoted_entity_id=(SELECT p.company_id FROM projects p WHERE p.id=NEW.promoted_project_id),investment_summary=NEW.summary,
        track=NEW.track,updated_at=NEW.updated_at WHERE legacy_project_candidate_id=NEW.id;
    END;
  `,
  downSql: `
    DROP TRIGGER IF EXISTS intelligence_legacy_candidate_insert;
    DROP TRIGGER IF EXISTS intelligence_legacy_candidate_update;
    ALTER TABLE entity_public_contacts DROP COLUMN review_candidate_id;
    ALTER TABLE entity_public_contacts DROP COLUMN reviewed_by;
    ALTER TABLE entity_public_contacts DROP COLUMN evidence_id;
    ALTER TABLE discovery_import_batches DROP COLUMN expires_at;
  `,
};
