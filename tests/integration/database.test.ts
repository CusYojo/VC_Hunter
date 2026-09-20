import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { SCHEMA_SQL } from "@/db/schema";
import { applyDatabaseMigrations, DATABASE_MIGRATIONS } from "@/db/migrations";
import { seedDemoData } from "@/db/seed";
import { SqliteProjectRepository } from "@/repositories/projects";

describe("evidence-first database", () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = createDatabase(":memory:");
    initializeDatabase(database);
  });

  afterEach(() => database.close());

  it("applies forward migrations exactly once", () => {
    initializeDatabase(database);

    expect(database.prepare("SELECT id FROM schema_migrations ORDER BY id").all()).toEqual([
      { id: "0001_baseline_marker" },
      { id: "0002_rss_ingestion" },
      { id: "0003_source_scoped_raw_artifacts" },
      { id: "0004_web_search_discovery" },
      { id: "0005_investment_talent_knowledge" },
      { id: "0006_background_agent" },
      { id: "0007_model_qualified_candidates" },
      { id: "0008_research_job_safety" },
      { id: "0009_modular_agent_runtime" },
      { id: "0010_prompt_revisions" },
      { id: "0011_investment_workbench" },
      { id: "0012_document_event_projection" },
      { id: "0013_investor_directory_deal_timeline" },
      { id: "0014_workspace_activity" },
      { id: "0015_candidate_details" },
      { id: "0016_workspace_activity_documents" },
      { id: "0017_project_document_annotations" },
      { id: "0018_personal_ai_settings" },
      { id: "0019_business_operations" },
      { id: "0020_ai_workspace" },
      { id: "0021_job_ai_requesters" },
      { id: "0022_candidate_documents" },
      { id: "0023_project_assistant" },
      { id: "0024_ai_chat" },
      { id: "0025_project_responsibles" },
      { id: "0026_activity_project_documents" },
      { id: "0027_business_operation_documents" },
      { id: "0028_candidate_queue" },
      { id: "0029_discovery_schedule" },
      { id: "0030_news_publication_verification" },
      { id: "0031_activity_comments" },
      { id: "0032_activity_edit" },
      { id: "0033_business_notifications" },
      { id: "0034_organization_office" },
      { id: "0035_comment_deletion" },
      { id: "0036_approval_lifecycle" },
      { id: "0037_workspace_activity_end_at" },
      { id: "0038_approval_view_status" },
      { id: "0040_office_member_profiles" },
      { id: "0041_project_deal_stage" },
      { id: "0042_workspace_task_archive_delete" },
      { id: "0043_intelligence_discovery" },
      { id: "0044_intelligence_legacy_backfill" },
      { id: "0045_intelligence_operations" },
      { id: "0046_intelligence_investment_valuation" },
      { id: "0047_intelligence_hardening" },
    ]);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='collection_runs'").get()).toMatchObject({ name: "collection_runs" });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='people'").get()).toMatchObject({ name: "people" });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='investment_events'").get()).toMatchObject({ name: "investment_events" });
  });

  it("upgrades a 0036 database with closed approvals and restores the response guard", () => {
    const upgradeDatabase = createDatabase(":memory:");
    try {
      upgradeDatabase.exec(SCHEMA_SQL);
      upgradeDatabase.exec("CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
      const record = upgradeDatabase.prepare("INSERT INTO schema_migrations(id,applied_at) VALUES(?,?)");
      for (const migration of DATABASE_MIGRATIONS) {
        if (migration.id === "0037_workspace_activity_end_at") break;
        upgradeDatabase.exec(migration.upSql);
        record.run(migration.id, "2026-09-06T00:00:00.000Z");
      }
      upgradeDatabase.prepare(`INSERT INTO workspace_activity(
        id,kind,title,description,due_at,location,created_by,created_at,updated_at,idempotency_key,input_json,status,withdrawn_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        "closed-approval", "approval", "历史审批", "", "2026-09-05T02:00:00.000Z", "", "owner", "2026-09-05T01:00:00.000Z", "2026-09-05T01:00:00.000Z", "closed-key", "{}", "active", null,
      );
      upgradeDatabase.prepare("INSERT INTO workspace_activity_responses(activity_id,member_id) VALUES(?,?)").run("closed-approval", "reviewer");
      upgradeDatabase.prepare(`INSERT INTO workspace_activity(
        id,kind,title,description,due_at,location,created_by,created_at,updated_at,idempotency_key,input_json,status,completed_at,archive_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        "archivable-approval", "approval", "待归档审批", "", "2026-09-05T02:00:00.000Z", "", "owner", "2026-09-05T01:00:00.000Z", "2026-09-05T01:00:00.000Z", "archive-key", "{}", "completed", "2026-09-05T02:00:00.000Z", "2026-09-05T03:00:00.000Z",
      );
      upgradeDatabase.prepare("UPDATE workspace_activity SET status='withdrawn',withdrawn_at=?,updated_at=?,version=version+1 WHERE id=?")
        .run("2026-09-05T03:00:00.000Z", "2026-09-05T03:00:00.000Z", "closed-approval");

      expect(() => applyDatabaseMigrations(upgradeDatabase)).not.toThrow();
      expect(() => upgradeDatabase.prepare("UPDATE workspace_activity SET status='archived',archived_at=?,updated_at=?,version=version+1,end_at=? WHERE id=?")
        .run("2026-09-05T04:00:00.000Z", "2026-09-05T04:00:00.000Z", "2099-01-01T00:00:00.000Z", "archivable-approval"))
        .toThrow("该审批已撤回、完成或归档，不能再修改。");
      expect(() => upgradeDatabase.prepare("UPDATE workspace_activity SET status='archived',archived_at=?,updated_at=?,version=version+1 WHERE id=?")
        .run("2026-09-05T04:00:00.000Z", "2026-09-05T04:00:00.000Z", "archivable-approval"))
        .not.toThrow();
      expect(upgradeDatabase.prepare("SELECT assigned_at,viewed_at FROM workspace_activity_responses WHERE activity_id=?").get("closed-approval"))
        .toEqual({ assigned_at: "2026-09-05T01:00:00.000Z", viewed_at: null });
      expect(() => upgradeDatabase.prepare("UPDATE workspace_activity_responses SET viewed_at=? WHERE activity_id=? AND member_id=?")
        .run("2026-09-06T02:00:00.000Z", "closed-approval", "reviewer"))
        .toThrow("该审批已撤回、完成或归档，不能再修改。");
      const viewMigration = DATABASE_MIGRATIONS.find(migration => migration.id === "0038_approval_view_status")!;
      expect(() => upgradeDatabase.exec(viewMigration.downSql)).not.toThrow();
      expect(upgradeDatabase.prepare("PRAGMA table_info(workspace_activity_responses)").all().map(column => column.name))
        .not.toEqual(expect.arrayContaining(["assigned_at", "viewed_at"]));
      expect(() => upgradeDatabase.prepare("UPDATE workspace_activity_responses SET note=? WHERE activity_id=? AND member_id=?")
        .run("篡改", "closed-approval", "reviewer"))
        .toThrow("该审批已撤回、完成或归档，不能再修改。");
    } finally { upgradeDatabase.close(); }
  });

  it("seeds all seven tracks and remains idempotent", () => {
    seedDemoData(database);
    seedDemoData(database);
    const repository = new SqliteProjectRepository(database);

    expect(repository.list()).toHaveLength(7);
    expect(new Set(repository.list().map((project) => project.track)).size).toBe(7);
    expect(repository.findById("project-qiongxin")?.urgencyScore).toBeGreaterThan(0);
    expect(repository.findById("project-qiongxin")?.dealStage).toBe("contact");
    expect(database.prepare("select count(*) as count from documents").get()).toMatchObject({ count: 8 });
  });

  it("surfaces company identity, official website, financing and M&A in Project 360 data", () => {
    seedDemoData(database);
    database.prepare("UPDATE companies SET unified_credit_code=?,official_domain=? WHERE id='company-tiansun'")
      .run("91310101PROJECT360", "tiansun.example.com");

    expect(new SqliteProjectRepository(database).findById("project-tiansun")?.companyIntelligence).toMatchObject({
      unifiedCreditCode: "91310101PROJECT360",
      officialWebsite: "https://tiansun.example.com",
      mergersAndAcquisitions: [expect.objectContaining({
        acquirerName: "演示航天集团",
        transactionType: "strategic_investment",
        transactionStage: "approved",
      })],
    });
  });

  it("makes every surfaced project traceable to evidence", () => {
    seedDemoData(database);
    const repository = new SqliteProjectRepository(database);

    for (const project of repository.list()) {
      const detail = repository.findById(project.id);
      expect(detail?.assertions.length).toBeGreaterThan(0);
      expect(detail?.assertions.every((assertion) => assertion.evidence.length > 0)).toBe(true);
    }
  });

  it("retains conflicting assertions instead of overwriting them", () => {
    seedDemoData(database);
    const repository = new SqliteProjectRepository(database);
    const project = repository.findById("project-qiongxin");
    const financingAssertions = project?.assertions.filter((assertion) => assertion.predicate === "funding_amount");

    expect(financingAssertions).toHaveLength(2);
    expect(financingAssertions?.map((assertion) => assertion.status)).toEqual(
      expect.arrayContaining(["active", "disputed"]),
    );
  });

  it("preserves undisclosed values as null, never zero", () => {
    seedDemoData(database);
    const repository = new SqliteProjectRepository(database);
    const project = repository.findById("project-yaoshi");
    const revenue = project?.assertions.find((assertion) => assertion.predicate === "revenue");

    expect(revenue?.valueStatus).toBe("not_disclosed");
    expect(revenue?.value).toBeNull();
    expect(revenue?.nullReason).toBeTruthy();
  });

  it("returns undefined for missing projects and evidence", () => {
    seedDemoData(database);
    const repository = new SqliteProjectRepository(database);
    expect(repository.findById("missing")).toBeUndefined();
    expect(repository.findEvidenceById("missing")).toBeUndefined();
    expect(repository.findEvidenceById("evidence-project-qiongxin")?.authority).toBe("A");
  });

  it("only marks explicitly approved public evidence as shareable with external models", () => {
    seedDemoData(database);
    const repository = new SqliteProjectRepository(database);
    const sourceId = database.prepare(`SELECT d.source_id
      FROM evidence_fragments ef JOIN documents d ON d.id=ef.document_id
      WHERE ef.id='evidence-project-qiongxin'`).get() as { source_id: string };

    database.prepare(`UPDATE sources SET access_mode='rss',policy_status='approved',terms_review_status='reviewed',
      access_class='licensed_internal',allow_external_model=0 WHERE id=?`).run(sourceId.source_id);
    expect(repository.findEvidenceById("evidence-project-qiongxin")?.modelShareable).toBe(false);
    expect(repository.findById("project-qiongxin")?.assertions.flatMap(assertion => assertion.evidence)
      .find(evidence => evidence.id === "evidence-project-qiongxin")?.modelShareable).toBe(false);

    database.prepare(`UPDATE sources SET access_class='public',allow_external_model=1 WHERE id=?`).run(sourceId.source_id);
    expect(repository.findEvidenceById("evidence-project-qiongxin")?.modelShareable).toBe(true);
  });
});
