import { approvalViewStatusMigration } from "./approval-view-status-migration";
import { activityCalendarMigration } from "@/workbench/activity-calendar-migration";
import { approvalLifecycleMigration } from "./approval-lifecycle-migration";
import { commentDeletionMigration } from "./comment-deletion-migration";
import { organizationOfficeMigration } from "./organization-office-migration";
import { notificationsMigration } from "./notifications-migration";
import { activityEditMigration } from "@/workbench/activity-edit-migration";
import { activityCommentsMigration } from "@/workbench/activity-comments-migration";
import { newsPublicationMigration } from "./news-publication-migration";
import { discoveryScheduleMigration } from "@/workbench/discovery-schedule-migration";
import { candidateQueueMigration } from "@/workbench/candidate-queue-migration";
import { activityProjectDocumentsMigration } from "@/workbench/activity-project-documents-migration";
import { businessOperationDocumentsMigration } from "@/workbench/business-operation-documents-migration";
import { projectResponsiblesMigration } from "@/workbench/project-responsibles-migration";
import { chatMigration } from "@/ai/chat-migration";
import { projectAssistantMigration } from "@/ai/project-assistant-migration";
import { candidateDocumentsMigration } from "@/workbench/candidate-documents-migration";
import { jobAIRequestersMigration } from "@/ai/job-requesters-migration";
import type { DatabaseSync } from "node:sqlite";
import { workspaceActivityMigration, workspaceActivityDocumentsMigration } from "./workspace-migration";
import { projectDocumentAnnotationsMigration } from "./project-document-annotations-migration";
import { candidateDetailsMigration } from "./candidate-details-migration";
import { personalAISettingsMigration } from "./personal-ai-settings-migration";
import { businessOperationsMigration } from "./business-operations-migration";
import { aiWorkspaceMigration } from "./ai-workspace-migration";
import { officeMemberProfilesMigration } from "./office-member-profiles-migration";
import { projectDealStageMigration } from "./project-deal-stage-migration";
import { taskLifecycleMigration } from "@/workbench/task-lifecycle-migration";
import { intelligenceDiscoveryMigration, intelligenceHardeningMigration, intelligenceInvestmentValuationMigration, intelligenceLegacyBackfillMigration, intelligenceOperationsMigration } from "@/intelligence/migration";

export interface DatabaseMigration {
  id: string;
  upSql: string;
  downSql: string;
}

export const DATABASE_MIGRATIONS: readonly DatabaseMigration[] = [
  {
    id: "0001_baseline_marker",
    upSql: "SELECT 1;",
    downSql: "SELECT 1;",
  },
  {
    id: "0002_rss_ingestion",
    upSql: `
      CREATE TABLE source_feeds (
        source_id TEXT PRIMARY KEY REFERENCES sources(id),
        endpoint_url TEXT NOT NULL,
        allowed_hostname TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
        timeout_ms INTEGER NOT NULL DEFAULT 10000,
        max_response_bytes INTEGER NOT NULL DEFAULT 2097152,
        max_items INTEGER NOT NULL DEFAULT 200,
        etag TEXT,
        last_modified TEXT,
        last_success_at TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        config_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE collection_runs (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES sources(id),
        status TEXT NOT NULL CHECK (status IN ('running','succeeded','not_modified','failed','blocked')),
        started_at TEXT NOT NULL,
        finished_at TEXT,
        http_status INTEGER,
        final_url TEXT,
        response_bytes INTEGER,
        discovered_count INTEGER NOT NULL DEFAULT 0,
        inserted_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        error_code TEXT,
        error_message TEXT,
        trace_id TEXT NOT NULL UNIQUE
      );

      CREATE TABLE raw_fetch_artifacts (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES sources(id),
        content_hash TEXT NOT NULL UNIQUE,
        storage_key TEXT NOT NULL,
        media_type TEXT NOT NULL,
        byte_length INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE run_artifacts (
        run_id TEXT NOT NULL REFERENCES collection_runs(id),
        artifact_id TEXT NOT NULL REFERENCES raw_fetch_artifacts(id),
        PRIMARY KEY (run_id, artifact_id)
      );

      CREATE TABLE feed_items (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES sources(id),
        stable_key TEXT NOT NULL,
        external_id TEXT NOT NULL,
        canonical_url TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        current_version_id TEXT,
        UNIQUE (source_id, stable_key)
      );

      CREATE TABLE feed_item_versions (
        id TEXT PRIMARY KEY,
        feed_item_id TEXT NOT NULL REFERENCES feed_items(id),
        collection_run_id TEXT NOT NULL REFERENCES collection_runs(id),
        content_hash TEXT NOT NULL,
        title TEXT NOT NULL,
        excerpt TEXT NOT NULL,
        published_at TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        document_id TEXT NOT NULL REFERENCES documents(id),
        UNIQUE (feed_item_id, content_hash)
      );

      CREATE TABLE discovery_candidates (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) UNIQUE,
        matched_track TEXT,
        matched_keywords_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending_entity_resolution','dismissed','promoted')),
        created_at TEXT NOT NULL
      );

      CREATE INDEX idx_collection_runs_source_started ON collection_runs(source_id, started_at DESC);
      CREATE INDEX idx_feed_item_versions_run ON feed_item_versions(collection_run_id);
      CREATE INDEX idx_discovery_candidates_status ON discovery_candidates(status, created_at DESC);
    `,
    downSql: `
      DROP TABLE IF EXISTS discovery_candidates;
      DROP TABLE IF EXISTS feed_item_versions;
      DROP TABLE IF EXISTS feed_items;
      DROP TABLE IF EXISTS run_artifacts;
      DROP TABLE IF EXISTS raw_fetch_artifacts;
      DROP TABLE IF EXISTS collection_runs;
      DROP TABLE IF EXISTS source_feeds;
    `,
  },
  {
    id: "0003_source_scoped_raw_artifacts",
    upSql: `
      CREATE TABLE raw_fetch_artifacts_v2 (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES sources(id),
        content_hash TEXT NOT NULL,
        storage_key TEXT NOT NULL,
        media_type TEXT NOT NULL,
        byte_length INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (source_id, content_hash)
      );
      CREATE TABLE run_artifacts_v2 (
        run_id TEXT NOT NULL REFERENCES collection_runs(id),
        artifact_id TEXT NOT NULL REFERENCES raw_fetch_artifacts_v2(id),
        PRIMARY KEY (run_id, artifact_id)
      );
      INSERT INTO raw_fetch_artifacts_v2
        SELECT DISTINCT rfa.id || ':' || cr.source_id,cr.source_id,rfa.content_hash,rfa.storage_key,rfa.media_type,rfa.byte_length,rfa.created_at
        FROM raw_fetch_artifacts rfa JOIN run_artifacts ra ON ra.artifact_id=rfa.id JOIN collection_runs cr ON cr.id=ra.run_id;
      INSERT OR IGNORE INTO raw_fetch_artifacts_v2
        SELECT id,source_id,content_hash,storage_key,media_type,byte_length,created_at FROM raw_fetch_artifacts
        WHERE id NOT IN (SELECT artifact_id FROM run_artifacts);
      INSERT INTO run_artifacts_v2
        SELECT ra.run_id,rfa.id || ':' || cr.source_id
        FROM run_artifacts ra JOIN raw_fetch_artifacts rfa ON rfa.id=ra.artifact_id JOIN collection_runs cr ON cr.id=ra.run_id;
      DROP TABLE run_artifacts;
      DROP TABLE raw_fetch_artifacts;
      ALTER TABLE raw_fetch_artifacts_v2 RENAME TO raw_fetch_artifacts;
      ALTER TABLE run_artifacts_v2 RENAME TO run_artifacts;
    `,
    downSql: `
      CREATE TABLE raw_fetch_artifacts_global (
        id TEXT PRIMARY KEY,source_id TEXT NOT NULL REFERENCES sources(id),content_hash TEXT NOT NULL UNIQUE,
        storage_key TEXT NOT NULL,media_type TEXT NOT NULL,byte_length INTEGER NOT NULL,created_at TEXT NOT NULL
      );
      CREATE TABLE run_artifacts_global (
        run_id TEXT NOT NULL REFERENCES collection_runs(id),artifact_id TEXT NOT NULL REFERENCES raw_fetch_artifacts_global(id),PRIMARY KEY (run_id,artifact_id)
      );
      INSERT INTO raw_fetch_artifacts_global SELECT min(id),min(source_id),content_hash,min(storage_key),min(media_type),min(byte_length),min(created_at)
        FROM raw_fetch_artifacts GROUP BY content_hash;
      INSERT INTO run_artifacts_global SELECT ra.run_id,global_artifact.id FROM run_artifacts ra
        JOIN raw_fetch_artifacts scoped_artifact ON scoped_artifact.id=ra.artifact_id
        JOIN raw_fetch_artifacts_global global_artifact ON global_artifact.content_hash=scoped_artifact.content_hash;
      DROP TABLE run_artifacts;
      DROP TABLE raw_fetch_artifacts;
      ALTER TABLE raw_fetch_artifacts_global RENAME TO raw_fetch_artifacts;
      ALTER TABLE run_artifacts_global RENAME TO run_artifacts;
    `,
  },
  {
    id: "0004_web_search_discovery",
    upSql: `
      CREATE TABLE web_search_runs (
        id TEXT PRIMARY KEY,provider TEXT NOT NULL,query TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed')),
        started_at TEXT NOT NULL,finished_at TEXT,provider_request_id TEXT,result_count INTEGER NOT NULL DEFAULT 0,
        inserted_count INTEGER NOT NULL DEFAULT 0,skipped_count INTEGER NOT NULL DEFAULT 0,error_code TEXT,trace_id TEXT NOT NULL UNIQUE
      );
      CREATE TABLE web_search_leads (
        id TEXT PRIMARY KEY,url TEXT NOT NULL UNIQUE,title TEXT NOT NULL,published_at TEXT,highlights_json TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,last_seen_at TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('discovered','dismissed','promoted'))
      );
      CREATE TABLE web_search_run_leads (
        run_id TEXT NOT NULL REFERENCES web_search_runs(id),lead_id TEXT NOT NULL REFERENCES web_search_leads(id),rank INTEGER NOT NULL,
        PRIMARY KEY(run_id,lead_id)
      );
      CREATE INDEX idx_web_search_runs_started ON web_search_runs(started_at DESC);
      CREATE INDEX idx_web_search_leads_status ON web_search_leads(status,last_seen_at DESC);
    `,
    downSql: `DROP TABLE IF EXISTS web_search_run_leads; DROP TABLE IF EXISTS web_search_leads; DROP TABLE IF EXISTS web_search_runs;`,
  },
  {
    id: "0005_investment_talent_knowledge",
    upSql: `
      ALTER TABLE companies ADD COLUMN unified_credit_code TEXT;
      ALTER TABLE companies ADD COLUMN registration_status TEXT;
      ALTER TABLE companies ADD COLUMN incorporation_date TEXT;

      CREATE TABLE investors (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        aliases_json TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('vc','pe','cvc','government_fund','incubator','other')),
        headquarters TEXT,
        focus_tracks_json TEXT NOT NULL,
        stage_focus_json TEXT NOT NULL,
        track_performance_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE investment_events (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id),
        round TEXT NOT NULL CHECK (round IN ('angel','pre_a','a','b','c','d_plus','strategic','other')),
        announced_at TEXT NOT NULL,
        amount INTEGER,
        currency TEXT CHECK (currency IN ('CNY','USD')),
        disclosure_type TEXT NOT NULL CHECK (disclosure_type IN ('exact','range','undisclosed','estimated')),
        investors_json TEXT NOT NULL,
        lead_investors_json TEXT NOT NULL,
        confidence REAL NOT NULL,
        source_refs_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_investment_events_company ON investment_events(company_id, announced_at DESC);
      CREATE INDEX idx_investment_events_announced ON investment_events(announced_at DESC);

      CREATE TABLE ma_events (
        id TEXT PRIMARY KEY,
        target_company_id TEXT NOT NULL REFERENCES companies(id),
        acquirer_name TEXT NOT NULL,
        announcement_date TEXT NOT NULL,
        transaction_type TEXT NOT NULL CHECK (transaction_type IN ('acquisition','merger','asset_purchase','strategic_investment')),
        transaction_value INTEGER,
        currency TEXT CHECK (currency IN ('CNY','USD')),
        transaction_stage TEXT NOT NULL CHECK (transaction_stage IN ('proposed','approved','closed','terminated')),
        strategic_rationale TEXT,
        source_refs_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_ma_events_target ON ma_events(target_company_id, announcement_date DESC);

      CREATE TABLE people (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        aliases_json TEXT NOT NULL,
        current_organization TEXT,
        current_title TEXT,
        track TEXT,
        previous_startups_json TEXT NOT NULL,
        technical_evidence_count INTEGER NOT NULL DEFAULT 0,
        privacy_basis TEXT NOT NULL CHECK (privacy_basis IN ('public_statement','registry_record','professional_profile','paper_authorship','patent_applicant')),
        confidence REAL NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_people_name ON people(name);
      CREATE INDEX idx_people_track ON people(track);

      CREATE TABLE person_company_roles (
        person_id TEXT NOT NULL REFERENCES people(id),
        company_id TEXT NOT NULL REFERENCES companies(id),
        role TEXT NOT NULL,
        PRIMARY KEY (person_id, company_id, role)
      );

      CREATE TABLE person_events (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES people(id),
        event_type TEXT NOT NULL CHECK (event_type IN ('joined_company','left_company','started_company','became_advisor','paper_published','patent_filed','executive_hiring','public_profile_changed')),
        occurred_at TEXT NOT NULL,
        summary TEXT NOT NULL,
        target_company_id TEXT REFERENCES companies(id),
        confidence REAL NOT NULL,
        alert_severity TEXT CHECK (alert_severity IN ('high','medium','review')),
        evidence_id TEXT REFERENCES evidence_fragments(id),
        dedupe_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_person_events_person ON person_events(person_id, occurred_at DESC);
      CREATE INDEX idx_person_events_severity ON person_events(alert_severity, occurred_at DESC);

      CREATE TABLE topic_knowledge_cards (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL UNIQUE,
        track TEXT,
        scope TEXT NOT NULL CHECK (scope IN ('track','topic')),
        summary TEXT NOT NULL,
        definition TEXT NOT NULL,
        keywords_json TEXT NOT NULL,
        hotness INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_topic_knowledge_track ON topic_knowledge_cards(track);
    `,
    downSql: `
      DROP TABLE IF EXISTS topic_knowledge_cards;
      DROP TABLE IF EXISTS person_events;
      DROP TABLE IF EXISTS person_company_roles;
      DROP TABLE IF EXISTS people;
      DROP TABLE IF EXISTS ma_events;
      DROP TABLE IF EXISTS investment_events;
      DROP TABLE IF EXISTS investors;
      ALTER TABLE companies DROP COLUMN incorporation_date;
      ALTER TABLE companies DROP COLUMN registration_status;
      ALTER TABLE companies DROP COLUMN unified_credit_code;
    `,
  },
  {
    id: "0006_background_agent",
    upSql: `
      CREATE TABLE agent_search_plans (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        query TEXT NOT NULL,
        interval_minutes INTEGER NOT NULL CHECK (interval_minutes BETWEEN 5 AND 10080),
        result_limit INTEGER NOT NULL CHECK (result_limit BETWEEN 1 AND 50),
        enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
        next_run_at TEXT NOT NULL,
        lease_owner TEXT,
        lease_until TEXT,
        last_started_at TEXT,
        last_finished_at TEXT,
        last_status TEXT CHECK (last_status IN ('succeeded','failed')),
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        last_error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_agent_search_plans_due ON agent_search_plans(enabled,next_run_at,lease_until);

      ALTER TABLE research_jobs ADD COLUMN started_at TEXT;
      ALTER TABLE research_jobs ADD COLUMN finished_at TEXT;
      ALTER TABLE research_jobs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE research_jobs ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3;
      ALTER TABLE research_jobs ADD COLUMN next_attempt_at TEXT;
      ALTER TABLE research_jobs ADD COLUMN lease_owner TEXT;
      ALTER TABLE research_jobs ADD COLUMN lease_until TEXT;
      ALTER TABLE research_jobs ADD COLUMN error_code TEXT;
      CREATE INDEX idx_research_jobs_claim ON research_jobs(status,next_attempt_at,lease_until,created_at);

      CREATE TABLE research_reports (
        id TEXT PRIMARY KEY,
        research_job_id TEXT NOT NULL UNIQUE REFERENCES research_jobs(id),
        project_id TEXT NOT NULL REFERENCES projects(id),
        model TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft','reviewed','rejected')),
        summary TEXT NOT NULL,
        findings_json TEXT NOT NULL,
        risks_json TEXT NOT NULL,
        open_questions_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_research_reports_project ON research_reports(project_id,created_at DESC);

      CREATE TABLE platform_timeline (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        project_id TEXT REFERENCES projects(id),
        actor TEXT NOT NULL,
        summary TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        trace_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_platform_timeline_created ON platform_timeline(created_at DESC);
      CREATE INDEX idx_platform_timeline_project ON platform_timeline(project_id,created_at DESC);
    `,
    downSql: `
      DROP TABLE IF EXISTS platform_timeline;
      DROP TABLE IF EXISTS research_reports;
      DROP INDEX IF EXISTS idx_research_jobs_claim;
      ALTER TABLE research_jobs DROP COLUMN error_code;
      ALTER TABLE research_jobs DROP COLUMN lease_until;
      ALTER TABLE research_jobs DROP COLUMN lease_owner;
      ALTER TABLE research_jobs DROP COLUMN next_attempt_at;
      ALTER TABLE research_jobs DROP COLUMN max_attempts;
      ALTER TABLE research_jobs DROP COLUMN attempt_count;
      ALTER TABLE research_jobs DROP COLUMN finished_at;
      ALTER TABLE research_jobs DROP COLUMN started_at;
      DROP TABLE IF EXISTS agent_search_plans;
    `,
  },
  {
    id: "0007_model_qualified_candidates",
    upSql: `
      CREATE TABLE IF NOT EXISTS project_candidates (
        id TEXT PRIMARY KEY,
        lead_id TEXT NOT NULL UNIQUE REFERENCES web_search_leads(id),
        company_name TEXT NOT NULL,
        track TEXT NOT NULL,
        investor_names_json TEXT NOT NULL,
        signal_type TEXT NOT NULL,
        summary TEXT NOT NULL,
        confidence REAL NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending_review','promoted','dismissed')),
        model TEXT NOT NULL,
        prompt_version TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_project_candidates_review ON project_candidates(status,created_at DESC);
    `,
    downSql: `DROP TABLE IF EXISTS project_candidates;`,
  },
  {
    id: "0008_research_job_safety",
    upSql: `
      ALTER TABLE research_jobs ADD COLUMN project_status_before TEXT;
      CREATE UNIQUE INDEX idx_research_jobs_one_active_project
        ON research_jobs(project_id) WHERE status IN ('queued','running');
    `,
    downSql: `
      DROP INDEX IF EXISTS idx_research_jobs_one_active_project;
      ALTER TABLE research_jobs DROP COLUMN project_status_before;
    `,
  },
  {
    id: "0009_modular_agent_runtime",
    upSql: `
      ALTER TABLE agent_search_plans ADD COLUMN workflow_id TEXT NOT NULL DEFAULT 'project-discovery';
      ALTER TABLE agent_search_plans ADD COLUMN workflow_version TEXT NOT NULL DEFAULT '1.0.0';
      ALTER TABLE agent_search_plans ADD COLUMN search_provider_id TEXT NOT NULL DEFAULT 'deepseek-web-search';
      ALTER TABLE agent_search_plans ADD COLUMN search_provider_version TEXT NOT NULL DEFAULT '1.0.0';
      ALTER TABLE research_jobs ADD COLUMN workflow_id TEXT NOT NULL DEFAULT 'project-research';
      ALTER TABLE research_jobs ADD COLUMN workflow_version TEXT NOT NULL DEFAULT '1.0.0';

      CREATE TABLE workflow_runs (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        workflow_version TEXT NOT NULL,
        trigger_type TEXT NOT NULL,
        trigger_ref TEXT,
        status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed')),
        trace_id TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        error_code TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE INDEX idx_workflow_runs_started ON workflow_runs(started_at DESC);
      CREATE INDEX idx_workflow_runs_trigger ON workflow_runs(trigger_type,trigger_ref,started_at DESC);

      CREATE TABLE workflow_step_runs (
        id TEXT PRIMARY KEY,
        workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id),
        step_id TEXT NOT NULL,
        step_version TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed')),
        skill_id TEXT,
        skill_version TEXT,
        prompt_id TEXT,
        prompt_version TEXT,
        prompt_hash TEXT,
        provider_id TEXT,
        model TEXT,
        provider_request_id TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        total_tokens INTEGER,
        latency_ms INTEGER,
        input_hash TEXT,
        output_hash TEXT,
        error_code TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE INDEX idx_workflow_step_runs_workflow ON workflow_step_runs(workflow_run_id,started_at);
    `,
    downSql: `
      DROP TABLE IF EXISTS workflow_step_runs;
      DROP TABLE IF EXISTS workflow_runs;
      ALTER TABLE research_jobs DROP COLUMN workflow_version;
      ALTER TABLE research_jobs DROP COLUMN workflow_id;
      ALTER TABLE agent_search_plans DROP COLUMN search_provider_version;
      ALTER TABLE agent_search_plans DROP COLUMN search_provider_id;
      ALTER TABLE agent_search_plans DROP COLUMN workflow_version;
      ALTER TABLE agent_search_plans DROP COLUMN workflow_id;
    `,
  },
  {
    id: "0010_prompt_revisions",
    upSql: `
      ALTER TABLE workflow_step_runs ADD COLUMN requested_model TEXT;
      CREATE TABLE prompt_revisions (
        prompt_id TEXT NOT NULL,
        prompt_version TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(prompt_id,prompt_version)
      );
    `,
    downSql: `DROP TABLE IF EXISTS prompt_revisions; ALTER TABLE workflow_step_runs DROP COLUMN requested_model;`,
  },
  {
    id: "0011_investment_workbench",
    upSql: `
      ALTER TABLE projects ADD COLUMN score_urgency INTEGER;
      ALTER TABLE projects ADD COLUMN score_quality INTEGER;
      ALTER TABLE projects ADD COLUMN score_evidence REAL;
      ALTER TABLE projects ADD COLUMN owner_id TEXT;
      ALTER TABLE projects ADD COLUMN suggested_owner_id TEXT;
      UPDATE projects SET score_urgency=urgency_score,score_quality=quality_score,score_evidence=evidence_quality,owner_id=owner;

      ALTER TABLE project_candidates ADD COLUMN review_version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE project_candidates ADD COLUMN reviewed_by TEXT;
      ALTER TABLE project_candidates ADD COLUMN reviewed_at TEXT;
      ALTER TABLE project_candidates ADD COLUMN review_reason TEXT;
      ALTER TABLE project_candidates ADD COLUMN promoted_project_id TEXT REFERENCES projects(id);
      ALTER TABLE project_candidates ADD COLUMN review_idempotency_key TEXT;
      CREATE UNIQUE INDEX idx_candidate_review_idempotency ON project_candidates(review_idempotency_key) WHERE review_idempotency_key IS NOT NULL;

      ALTER TABLE research_jobs ADD COLUMN profile_id TEXT;
      ALTER TABLE research_jobs ADD COLUMN profile_version TEXT;
      ALTER TABLE research_jobs ADD COLUMN skill_refs_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE research_jobs ADD COLUMN requested_by TEXT;
      ALTER TABLE research_jobs ADD COLUMN instructions TEXT NOT NULL DEFAULT '';

      CREATE TABLE discovery_jobs (
        id TEXT PRIMARY KEY,query_json TEXT NOT NULL,requested_by TEXT NOT NULL,idempotency_key TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed')),
        workflow_id TEXT NOT NULL,workflow_version TEXT NOT NULL,provider_id TEXT NOT NULL,provider_version TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,max_attempts INTEGER NOT NULL DEFAULT 3,next_attempt_at TEXT,
        lease_owner TEXT,lease_until TEXT,error_code TEXT,created_at TEXT NOT NULL,started_at TEXT,finished_at TEXT,
        UNIQUE(requested_by,idempotency_key)
      );
      CREATE INDEX idx_discovery_jobs_claim ON discovery_jobs(status,next_attempt_at,lease_until,created_at);

      CREATE TABLE project_documents (
        id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),original_name TEXT NOT NULL,storage_key TEXT NOT NULL UNIQUE,
        media_type TEXT NOT NULL,document_kind TEXT NOT NULL CHECK(document_kind IN ('pdf','docx','text','markdown')),
        byte_length INTEGER NOT NULL,sha256 TEXT NOT NULL,confidentiality TEXT NOT NULL DEFAULT 'internal',
        external_policy TEXT NOT NULL CHECK(external_policy IN ('local_only','external_allowed')) DEFAULT 'local_only',
        parse_status TEXT NOT NULL CHECK(parse_status IN ('queued','processing','succeeded','failed')),
        analysis_status TEXT NOT NULL CHECK(analysis_status IN ('queued','processing','succeeded','failed')),
        extracted_text TEXT,error_code TEXT,uploaded_by TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
        UNIQUE(project_id,sha256)
      );
      CREATE INDEX idx_project_documents_project ON project_documents(project_id,created_at DESC);

      CREATE TABLE document_analysis_jobs (
        id TEXT PRIMARY KEY,document_id TEXT NOT NULL UNIQUE REFERENCES project_documents(id),project_id TEXT NOT NULL REFERENCES projects(id),
        status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed')),attempt_count INTEGER NOT NULL DEFAULT 0,max_attempts INTEGER NOT NULL DEFAULT 3,
        next_attempt_at TEXT,lease_owner TEXT,lease_until TEXT,error_code TEXT,created_at TEXT NOT NULL,started_at TEXT,finished_at TEXT
      );
      CREATE INDEX idx_document_analysis_claim ON document_analysis_jobs(status,next_attempt_at,lease_until,created_at);

      CREATE TABLE project_judgments (
        id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),actor_id TEXT NOT NULL,stance TEXT NOT NULL,
        thesis TEXT NOT NULL,occurred_at TEXT NOT NULL,idempotency_key TEXT NOT NULL,created_at TEXT NOT NULL,
        UNIQUE(actor_id,idempotency_key)
      );
      CREATE INDEX idx_project_judgments_timeline ON project_judgments(project_id,occurred_at DESC);

      CREATE TABLE knowledge_entries (
        id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(id),track TEXT,type TEXT NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK(source_type IN ('document','research_report','evidence')),source_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('draft','approved','rejected')),version INTEGER NOT NULL DEFAULT 1,
        created_by TEXT NOT NULL,reviewed_by TEXT,reviewed_at TEXT,review_note TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_knowledge_entries_filter ON knowledge_entries(status,track,project_id,created_at DESC);

      CREATE TABLE workbench_idempotency (
        actor_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,action TEXT NOT NULL,resource_id TEXT NOT NULL,payload_json TEXT NOT NULL,created_at TEXT NOT NULL,
        PRIMARY KEY(actor_id,idempotency_key)
      );
      CREATE UNIQUE INDEX idx_audit_write_idempotency ON audit_log(actor,action,request_id);
    `,
    downSql: `
      DROP INDEX IF EXISTS idx_audit_write_idempotency; DROP TABLE IF EXISTS workbench_idempotency; DROP TABLE IF EXISTS knowledge_entries; DROP TABLE IF EXISTS project_judgments;
      DROP TABLE IF EXISTS document_analysis_jobs; DROP TABLE IF EXISTS project_documents; DROP TABLE IF EXISTS discovery_jobs;
      DROP INDEX IF EXISTS idx_candidate_review_idempotency;
      ALTER TABLE research_jobs DROP COLUMN instructions; ALTER TABLE research_jobs DROP COLUMN requested_by;
      ALTER TABLE research_jobs DROP COLUMN skill_refs_json; ALTER TABLE research_jobs DROP COLUMN profile_version; ALTER TABLE research_jobs DROP COLUMN profile_id;
      ALTER TABLE project_candidates DROP COLUMN review_idempotency_key; ALTER TABLE project_candidates DROP COLUMN promoted_project_id;
      ALTER TABLE project_candidates DROP COLUMN review_reason; ALTER TABLE project_candidates DROP COLUMN reviewed_at;
      ALTER TABLE project_candidates DROP COLUMN reviewed_by; ALTER TABLE project_candidates DROP COLUMN review_version;
      ALTER TABLE projects DROP COLUMN suggested_owner_id; ALTER TABLE projects DROP COLUMN owner_id;
      ALTER TABLE projects DROP COLUMN score_evidence; ALTER TABLE projects DROP COLUMN score_quality; ALTER TABLE projects DROP COLUMN score_urgency;
    `,
  },
  {
    id: "0012_document_event_projection",
    upSql: `
      CREATE TABLE document_extracted_events (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES project_documents(id),
        project_id TEXT NOT NULL REFERENCES projects(id),
        occurred_at TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        confidence REAL NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(document_id,occurred_at,summary)
      );
      CREATE INDEX idx_document_extracted_events_timeline ON document_extracted_events(project_id,occurred_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_write_idempotency ON audit_log(actor,action,request_id);
    `,
    downSql: `DROP TABLE IF EXISTS document_extracted_events;`,
  },
  {
    id: "0013_investor_directory_deal_timeline",
    upSql: `
      ALTER TABLE investors ADD COLUMN english_name TEXT;
      ALTER TABLE investors ADD COLUMN institution_type TEXT NOT NULL DEFAULT 'financial_vc';
      ALTER TABLE investors ADD COLUMN subtracks_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE investors ADD COLUMN check_size_json TEXT;
      ALTER TABLE investors ADD COLUMN investment_style TEXT;
      ALTER TABLE investors ADD COLUMN thesis TEXT;
      ALTER TABLE investors ADD COLUMN key_people_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE investors ADD COLUMN portfolio_sample_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE investors ADD COLUMN fund_size_json TEXT;
      ALTER TABLE investors ADD COLUMN source_refs_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE investors ADD COLUMN status TEXT NOT NULL DEFAULT 'seed_candidate';
      ALTER TABLE investors ADD COLUMN priority INTEGER NOT NULL DEFAULT 2;
      ALTER TABLE investors ADD COLUMN rank INTEGER;
      ALTER TABLE investors ADD COLUMN verification_json TEXT;
      ALTER TABLE investors ADD COLUMN notes TEXT NOT NULL DEFAULT '';
      ALTER TABLE investors ADD COLUMN extra_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE investors ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE investors ADD COLUMN updated_at TEXT;
      UPDATE investors SET institution_type = CASE type
        WHEN 'vc' THEN 'financial_vc' WHEN 'government_fund' THEN 'local_government' ELSE type END,
        status = 'active', updated_at = created_at;
      CREATE INDEX idx_investors_directory ON investors(status, priority, rank, name);

      CREATE TABLE project_milestones (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        stage TEXT NOT NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'custom',
        status TEXT NOT NULL CHECK (status IN ('planned','in_progress','done','blocked','cancelled')),
        planned_at TEXT,
        occurred_at TEXT,
        owner_id TEXT,
        conclusion TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_project_milestones_project ON project_milestones(project_id, stage, sort_order, created_at);

      CREATE TABLE project_milestone_attachments (
        id TEXT PRIMARY KEY,
        milestone_id TEXT NOT NULL REFERENCES project_milestones(id),
        project_id TEXT NOT NULL REFERENCES projects(id),
        title TEXT NOT NULL,
        uri TEXT,
        document_id TEXT REFERENCES project_documents(id),
        note TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_project_milestone_attachments ON project_milestone_attachments(milestone_id, created_at);

      CREATE TABLE project_comments (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        milestone_id TEXT REFERENCES project_milestones(id),
        author_id TEXT NOT NULL,
        body TEXT NOT NULL,
        mentions_json TEXT NOT NULL DEFAULT '[]',
        idempotency_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(author_id, idempotency_key)
      );
      CREATE INDEX idx_project_comments_project ON project_comments(project_id, milestone_id, created_at);

      CREATE TABLE member_notifications (
        id TEXT PRIMARY KEY,
        recipient_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('mention','milestone_assigned')),
        project_id TEXT REFERENCES projects(id),
        milestone_id TEXT,
        comment_id TEXT,
        message TEXT NOT NULL,
        read_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_member_notifications_inbox ON member_notifications(recipient_id, read_at, created_at);
    `,
    downSql: `
      DROP TABLE IF EXISTS member_notifications; DROP TABLE IF EXISTS project_comments;
      DROP TABLE IF EXISTS project_milestone_attachments; DROP TABLE IF EXISTS project_milestones;
      DROP INDEX IF EXISTS idx_investors_directory;
      ALTER TABLE investors DROP COLUMN updated_at; ALTER TABLE investors DROP COLUMN version; ALTER TABLE investors DROP COLUMN extra_json;
      ALTER TABLE investors DROP COLUMN notes; ALTER TABLE investors DROP COLUMN verification_json; ALTER TABLE investors DROP COLUMN rank;
      ALTER TABLE investors DROP COLUMN priority; ALTER TABLE investors DROP COLUMN status; ALTER TABLE investors DROP COLUMN source_refs_json;
      ALTER TABLE investors DROP COLUMN fund_size_json; ALTER TABLE investors DROP COLUMN portfolio_sample_json; ALTER TABLE investors DROP COLUMN key_people_json;
      ALTER TABLE investors DROP COLUMN thesis; ALTER TABLE investors DROP COLUMN investment_style; ALTER TABLE investors DROP COLUMN check_size_json;
      ALTER TABLE investors DROP COLUMN subtracks_json; ALTER TABLE investors DROP COLUMN institution_type; ALTER TABLE investors DROP COLUMN english_name;
    `,
  },
  workspaceActivityMigration,
  candidateDetailsMigration,
  workspaceActivityDocumentsMigration,
  projectDocumentAnnotationsMigration,
  personalAISettingsMigration,
  businessOperationsMigration,
  aiWorkspaceMigration,
  jobAIRequestersMigration,
  candidateDocumentsMigration,
  projectAssistantMigration,
  chatMigration,
  projectResponsiblesMigration,
  activityProjectDocumentsMigration,
  businessOperationDocumentsMigration,
  candidateQueueMigration,
  discoveryScheduleMigration,
  newsPublicationMigration,
  activityCommentsMigration,
  activityEditMigration,
  notificationsMigration,
  organizationOfficeMigration,
  commentDeletionMigration,
  approvalLifecycleMigration,
  activityCalendarMigration,
  approvalViewStatusMigration,
  officeMemberProfilesMigration,
  projectDealStageMigration,
  taskLifecycleMigration,
  intelligenceDiscoveryMigration,
  intelligenceLegacyBackfillMigration,
  intelligenceOperationsMigration,
  intelligenceInvestmentValuationMigration,
  intelligenceHardeningMigration,
];

export function applyDatabaseMigrations(database: DatabaseSync): void {
  database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  const hasMigration = database.prepare("SELECT 1 FROM schema_migrations WHERE id = ?");
  const recordMigration = database.prepare("INSERT INTO schema_migrations (id,applied_at) VALUES (?,?)");
  for (const migration of DATABASE_MIGRATIONS) {
    if (hasMigration.get(migration.id)) continue;
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.upSql);
      recordMigration.run(migration.id, new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}
