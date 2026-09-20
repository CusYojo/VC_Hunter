import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { SqliteFeedIngestionRepository } from "@/repositories/feed-ingestion";
import { ingestApprovedFeed } from "@/services/feed-ingestion";
import type { FeedTransport } from "@/connectors/syndication-feed";

describe("approved source ingestion", () => {
  let database: DatabaseSync;
  let repository: SqliteFeedIngestionRepository;

  beforeEach(() => {
    database = createDatabase(":memory:");
    initializeDatabase(database);
    repository = new SqliteFeedIngestionRepository(database);
    database.prepare(`INSERT INTO sources
      (id,name,source_type,authority,access_mode,robots_status,license_notes,policy_status,independent_group,last_checked_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run("source-live", "批准的演示 RSS", "official_feed", "A", "rss", "allowed", "仅存储事实摘要", "approved", "official-live", "2026-08-31T00:00:00.000Z");
    repository.upsertFeed({
      sourceId: "source-live",
      endpointUrl: "https://feeds.example.cn/news.xml",
      allowedHostname: "feeds.example.cn",
      enabled: true,
      timeoutMs: 10_000,
      maxResponseBytes: 2_097_152,
      maxItems: 200,
    });
  });

  afterEach(() => database.close());

  it("persists raw provenance, immutable documents, evidence and review candidates idempotently", async () => {
    const transport: FeedTransport = { fetch: vi.fn().mockResolvedValue({
      kind: "fetched",
      httpStatus: 200,
      finalUrl: "https://feeds.example.cn/news.xml",
      contentType: "application/rss+xml",
      rawBody: "<rss>raw</rss>",
      etag: "v1",
      lastModified: null,
      feed: { title: "批准信源", items: [{ externalId: "item-1", title: "先进封装客户验证", canonicalUrl: "https://feeds.example.cn/a", publishedAt: "2026-08-30T01:00:00.000Z", excerpt: "Chiplet 工程样品完成客户验证" }] },
    }) };

    const first = await ingestApprovedFeed(repository, transport, { sourceId: "source-live", traceId: "trace-1", observedAt: "2026-08-31T01:00:00.000Z" });
    const second = await ingestApprovedFeed(repository, transport, { sourceId: "source-live", traceId: "trace-2", observedAt: "2026-08-31T02:00:00.000Z" });

    expect(first).toMatchObject({ status: "succeeded", insertedCount: 1, skippedCount: 0 });
    expect(second).toMatchObject({ status: "succeeded", insertedCount: 0, skippedCount: 1 });
    expect(database.prepare("SELECT count(*) AS count FROM raw_fetch_artifacts").get()).toMatchObject({ count: 1 });
    expect(database.prepare("SELECT count(*) AS count FROM documents").get()).toMatchObject({ count: 1 });
    expect(database.prepare("SELECT count(*) AS count FROM evidence_fragments").get()).toMatchObject({ count: 1 });
    expect(database.prepare("SELECT matched_track,status FROM discovery_candidates").get()).toMatchObject({ matched_track: "半导体", status: "pending_entity_resolution" });
    expect(database.prepare("SELECT count(*) AS count FROM collection_runs WHERE status = 'succeeded'").get()).toMatchObject({ count: 2 });
  });

  it("does not call the transport for blocked, manual-only, disabled, or missing sources", async () => {
    const fetch = vi.fn();
    const transport: FeedTransport = { fetch };
    database.prepare("UPDATE sources SET policy_status = 'blocked' WHERE id = ?").run("source-live");

    await expect(ingestApprovedFeed(repository, transport, { sourceId: "source-live", traceId: "trace-blocked", observedAt: "2026-08-31T01:00:00.000Z" })).rejects.toThrow(/approved/i);
    expect(fetch).not.toHaveBeenCalled();
    expect(database.prepare("SELECT status,error_code FROM collection_runs ORDER BY started_at DESC LIMIT 1").get()).toMatchObject({ status: "blocked", error_code: "SOURCE_NOT_APPROVED" });
  });

  it("records not-modified and sanitized failure outcomes without partial documents", async () => {
    const notModified: FeedTransport = { fetch: vi.fn().mockResolvedValue({ kind: "not_modified", httpStatus: 304, finalUrl: "https://feeds.example.cn/news.xml", etag: "v1", lastModified: null }) };
    const result = await ingestApprovedFeed(repository, notModified, { sourceId: "source-live", traceId: "trace-304", observedAt: "2026-08-31T01:00:00.000Z" });
    expect(result.status).toBe("not_modified");

    const failed: FeedTransport = { fetch: vi.fn().mockRejectedValue(new Error("socket failed with token=secret")) };
    await expect(ingestApprovedFeed(repository, failed, { sourceId: "source-live", traceId: "trace-fail", observedAt: "2026-08-31T02:00:00.000Z" })).rejects.toThrow(/collection failed/i);
    expect(database.prepare("SELECT error_code,error_message FROM collection_runs WHERE trace_id = ?").get("trace-fail")).toMatchObject({ error_code: "FETCH_FAILED", error_message: "Feed collection failed." });
    expect(database.prepare("SELECT count(*) AS count FROM documents").get()).toMatchObject({ count: 0 });
  });

  it("keeps identical raw responses independently attributable across sources", async () => {
    database.prepare(`INSERT INTO sources
      (id,name,source_type,authority,access_mode,robots_status,license_notes,policy_status,independent_group,last_checked_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run("source-live-2", "第二批准 RSS", "official_feed", "A", "rss", "allowed", "仅存储事实摘要", "approved", "official-live-2", "2026-08-31T00:00:00.000Z");
    repository.upsertFeed({ sourceId: "source-live-2", endpointUrl: "https://feeds2.example.cn/news.xml", allowedHostname: "feeds2.example.cn", enabled: true, timeoutMs: 10_000, maxResponseBytes: 2_097_152, maxItems: 200 });
    const fetched = { kind: "fetched" as const, httpStatus: 200, finalUrl: "https://feeds.example.cn/news.xml", contentType: "application/rss+xml", rawBody: "<rss>same raw</rss>", etag: null, lastModified: null, feed: { title: "Feed", items: [] } };
    const transport: FeedTransport = { fetch: vi.fn().mockResolvedValue(fetched) };

    await ingestApprovedFeed(repository, transport, { sourceId: "source-live", traceId: "trace-source-one", observedAt: "2026-08-31T01:00:00.000Z" });
    await ingestApprovedFeed(repository, transport, { sourceId: "source-live-2", traceId: "trace-source-two", observedAt: "2026-08-31T01:01:00.000Z" });

    expect(database.prepare("SELECT count(*) AS count FROM raw_fetch_artifacts").get()).toMatchObject({ count: 2 });
    expect(database.prepare("SELECT count(DISTINCT source_id) AS count FROM raw_fetch_artifacts").get()).toMatchObject({ count: 2 });
  });
});
