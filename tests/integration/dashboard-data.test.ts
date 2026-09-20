import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { ensureDemoData, listAlerts, listDiscoveryCandidates, listKnowledgeCards, listSources } from "@/repositories/dashboard-data";
import { SqliteResearchJobRepository } from "@/repositories/research-jobs";
import { createResearchJob } from "@/services/research-jobs";

describe("dashboard projections", () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = createDatabase(":memory:");
    initializeDatabase(database);
    ensureDemoData(database);
  });

  afterEach(() => database.close());

  it("projects alerts, knowledge cards, and source operations data", () => {
    ensureDemoData(database);
    expect(listAlerts(database)).toHaveLength(7);
    expect(listKnowledgeCards(database)).toHaveLength(7);
    expect(listSources(database)).toHaveLength(8);
    expect(listSources(database).every((source) => source.documentCount >= 1)).toBe(true);
  });

  it("projects feed readiness, latest collection outcome, and pending candidates", () => {
    const now = "2026-08-31T03:00:00.000Z";
    database.prepare(`INSERT INTO source_feeds
      (source_id,endpoint_url,allowed_hostname,enabled,timeout_ms,max_response_bytes,max_items,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      "source-qiongxin", "https://news.example.com/rss.xml", "news.example.com", 1, 10_000, 2_097_152, 200, now, now,
    );
    database.prepare(`INSERT INTO collection_runs
      (id,source_id,status,started_at,finished_at,discovered_count,inserted_count,skipped_count,trace_id)
      VALUES (?,?,?,?,?,?,?,?,?)`).run("run-source-ops", "source-qiongxin", "succeeded", now, now, 2, 1, 1, "trace-source-ops");
    database.prepare(`INSERT INTO discovery_candidates
      (id,document_id,matched_track,matched_keywords_json,status,created_at)
      VALUES (?,?,?,?,?,?)`).run("candidate-source-ops", "doc-qiongxin", "半导体", "[]", "pending_entity_resolution", now);

    expect(listSources(database).find((source) => source.id === "source-qiongxin")).toMatchObject({
      connectorStatus: "enabled",
      lastRunStatus: "succeeded",
      lastRunAt: now,
      lastInsertedCount: 1,
      pendingCandidateCount: 1,
    });
    expect(listSources(database).find((source) => source.id === "source-xinglan")).toMatchObject({
      connectorStatus: "not_configured",
      lastRunStatus: null,
      pendingCandidateCount: 0,
    });
    expect(listDiscoveryCandidates(database)).toEqual([
      expect.objectContaining({ id: "candidate-source-ops", sourceName: "穹芯微电子演示公告", title: "完成新一轮融资并启动客户送测（演示）", matchedTrack: "半导体" }),
    ]);
  });

  it("persists idempotent research jobs in SQLite", () => {
    const repository = new SqliteResearchJobRepository(database);
    const input = { tenantId: "demo", projectId: "project-qiongxin", idempotencyKey: "sqlite-job-1" };
    const first = createResearchJob(repository, input);
    const second = createResearchJob(repository, input);

    expect(second.id).toBe(first.id);
    expect(repository.findByIdempotencyKey("demo", "missing")).toBeUndefined();
  });
});
