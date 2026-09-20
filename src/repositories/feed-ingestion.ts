import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { FeedFetchResult, FeedItem, FeedSourceConfiguration } from "@/connectors/syndication-feed";
import { InMemoryRawArtifactStore, type RawArtifactStore } from "@/connectors/raw-artifact-store";
import { classifyDiscoveryCandidate } from "@/domain/discovery-candidate";

export interface FeedRegistration {
  sourceId: string;
  endpointUrl: string;
  allowedHostname: string;
  enabled: boolean;
  timeoutMs: number;
  maxResponseBytes: number;
  maxItems: number;
}

export interface IngestionReceipt {
  runId: string;
  status: "succeeded" | "not_modified";
  discoveredCount: number;
  insertedCount: number;
  skippedCount: number;
}

interface FeedConfigurationRow extends Record<string, unknown> {
  source_id: string;
  endpoint_url: string;
  allowed_hostname: string;
  enabled: number;
  policy_status: string;
  access_mode: string;
  timeout_ms: number;
  max_response_bytes: number;
  max_items: number;
  etag: string | null;
  last_modified: string | null;
}

export class SqliteFeedIngestionRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly artifactStore: RawArtifactStore = new InMemoryRawArtifactStore(),
  ) {}

  upsertFeed(input: FeedRegistration): void {
    const now = new Date().toISOString();
    this.database.prepare(`INSERT INTO source_feeds
      (source_id,endpoint_url,allowed_hostname,enabled,timeout_ms,max_response_bytes,max_items,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(source_id) DO UPDATE SET endpoint_url=excluded.endpoint_url,allowed_hostname=excluded.allowed_hostname,
        enabled=excluded.enabled,timeout_ms=excluded.timeout_ms,max_response_bytes=excluded.max_response_bytes,
        max_items=excluded.max_items,
        etag=CASE WHEN source_feeds.endpoint_url<>excluded.endpoint_url OR source_feeds.allowed_hostname<>excluded.allowed_hostname THEN NULL ELSE source_feeds.etag END,
        last_modified=CASE WHEN source_feeds.endpoint_url<>excluded.endpoint_url OR source_feeds.allowed_hostname<>excluded.allowed_hostname THEN NULL ELSE source_feeds.last_modified END,
        last_success_at=CASE WHEN source_feeds.endpoint_url<>excluded.endpoint_url OR source_feeds.allowed_hostname<>excluded.allowed_hostname THEN NULL ELSE source_feeds.last_success_at END,
        config_version=source_feeds.config_version+CASE WHEN source_feeds.endpoint_url<>excluded.endpoint_url OR source_feeds.allowed_hostname<>excluded.allowed_hostname OR source_feeds.enabled<>excluded.enabled OR source_feeds.timeout_ms<>excluded.timeout_ms OR source_feeds.max_response_bytes<>excluded.max_response_bytes OR source_feeds.max_items<>excluded.max_items THEN 1 ELSE 0 END,
        updated_at=CASE WHEN source_feeds.endpoint_url<>excluded.endpoint_url OR source_feeds.allowed_hostname<>excluded.allowed_hostname OR source_feeds.enabled<>excluded.enabled OR source_feeds.timeout_ms<>excluded.timeout_ms OR source_feeds.max_response_bytes<>excluded.max_response_bytes OR source_feeds.max_items<>excluded.max_items THEN excluded.updated_at ELSE source_feeds.updated_at END`).run(
      input.sourceId, input.endpointUrl, input.allowedHostname, input.enabled ? 1 : 0, input.timeoutMs, input.maxResponseBytes, input.maxItems, now, now,
    );
  }

  findConfiguration(sourceId: string): FeedSourceConfiguration | undefined {
    const row = this.database.prepare(`SELECT sf.*,s.policy_status,s.access_mode
      FROM source_feeds sf JOIN sources s ON s.id=sf.source_id WHERE sf.source_id=?`).get(sourceId) as FeedConfigurationRow | undefined;
    return row ? {
      sourceId: row.source_id,
      endpointUrl: row.endpoint_url,
      allowedHostname: row.allowed_hostname,
      enabled: row.enabled === 1,
      policyStatus: row.policy_status,
      accessMode: row.access_mode,
      timeoutMs: row.timeout_ms,
      maxResponseBytes: row.max_response_bytes,
      maxItems: row.max_items,
      etag: row.etag,
      lastModified: row.last_modified,
    } : undefined;
  }

  beginRun(sourceId: string, traceId: string, startedAt: string): string {
    const runId = randomUUID();
    this.database.prepare(`INSERT INTO collection_runs (id,source_id,status,started_at,trace_id) VALUES (?,?,?,?,?)`).run(runId, sourceId, "running", startedAt, traceId);
    return runId;
  }

  blockRun(runId: string, finishedAt: string, code: string, message: string): void {
    this.database.prepare(`UPDATE collection_runs SET status='blocked',finished_at=?,error_code=?,error_message=? WHERE id=?`).run(finishedAt, code, message, runId);
  }

  failRun(runId: string, finishedAt: string, code: string): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`UPDATE collection_runs SET status='failed',finished_at=?,error_code=?,error_message=? WHERE id=?`).run(finishedAt, code, "Feed collection failed.", runId);
      this.database.prepare(`UPDATE source_feeds SET consecutive_failures=consecutive_failures+1,updated_at=? WHERE source_id=(SELECT source_id FROM collection_runs WHERE id=?)`).run(finishedAt, runId);
      this.database.exec("COMMIT");
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  completeNotModified(runId: string, sourceId: string, fetched: Extract<FeedFetchResult, { kind: "not_modified" }>, finishedAt: string): IngestionReceipt {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`UPDATE collection_runs SET status='not_modified',finished_at=?,http_status=?,final_url=? WHERE id=?`).run(finishedAt, fetched.httpStatus, fetched.finalUrl, runId);
      this.database.prepare(`UPDATE source_feeds SET etag=?,last_modified=?,last_success_at=?,consecutive_failures=0,updated_at=? WHERE source_id=?`).run(fetched.etag, fetched.lastModified, finishedAt, finishedAt, sourceId);
      this.database.prepare("UPDATE sources SET last_checked_at=? WHERE id=?").run(finishedAt, sourceId);
      this.database.exec("COMMIT");
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
    return { runId, status: "not_modified", discoveredCount: 0, insertedCount: 0, skippedCount: 0 };
  }

  async persistFetchedFeed(runId: string, configuration: FeedSourceConfiguration, fetched: Extract<FeedFetchResult, { kind: "fetched" }>, observedAt: string): Promise<IngestionReceipt> {
    const rawHash = hash(fetched.rawBody);
    const storageKey = await this.artifactStore.put(rawHash, fetched.rawBody);
    let insertedCount = 0;
    let skippedCount = 0;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const artifactId = `raw-${hash(`${configuration.sourceId}:${rawHash}`)}`;
      this.database.prepare(`INSERT INTO raw_fetch_artifacts (id,source_id,content_hash,storage_key,media_type,byte_length,created_at)
        VALUES (?,?,?,?,?,?,?) ON CONFLICT(source_id,content_hash) DO NOTHING`).run(artifactId, configuration.sourceId, rawHash, storageKey, fetched.contentType, Buffer.byteLength(fetched.rawBody), observedAt);
      const storedArtifact = this.database.prepare("SELECT id FROM raw_fetch_artifacts WHERE source_id=? AND content_hash=?").get(configuration.sourceId, rawHash) as { id: string };
      this.database.prepare("INSERT INTO run_artifacts (run_id,artifact_id) VALUES (?,?) ON CONFLICT DO NOTHING").run(runId, storedArtifact.id);

      for (const item of fetched.feed.items) {
        const outcome = this.persistItem(runId, configuration.sourceId, item, observedAt);
        if (outcome === "inserted") insertedCount += 1; else skippedCount += 1;
      }
      this.database.prepare(`UPDATE collection_runs SET status='succeeded',finished_at=?,http_status=?,final_url=?,response_bytes=?,
        discovered_count=?,inserted_count=?,skipped_count=? WHERE id=?`).run(observedAt, fetched.httpStatus, fetched.finalUrl, Buffer.byteLength(fetched.rawBody), fetched.feed.items.length, insertedCount, skippedCount, runId);
      this.database.prepare(`UPDATE source_feeds SET etag=?,last_modified=?,last_success_at=?,consecutive_failures=0,updated_at=? WHERE source_id=?`).run(fetched.etag, fetched.lastModified, observedAt, observedAt, configuration.sourceId);
      this.database.prepare("UPDATE sources SET last_checked_at=? WHERE id=?").run(observedAt, configuration.sourceId);
      this.database.exec("COMMIT");
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
    return { runId, status: "succeeded", discoveredCount: fetched.feed.items.length, insertedCount, skippedCount };
  }

  private persistItem(runId: string, sourceId: string, item: FeedItem, observedAt: string): "inserted" | "skipped" {
    const stableKey = item.externalId || item.canonicalUrl;
    const itemId = `feed-item-${hash(`${sourceId}:${stableKey}`)}`;
    this.database.prepare(`INSERT INTO feed_items (id,source_id,stable_key,external_id,canonical_url,first_seen_at,last_seen_at)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(source_id,stable_key) DO UPDATE SET canonical_url=excluded.canonical_url,last_seen_at=excluded.last_seen_at`).run(itemId, sourceId, stableKey, item.externalId, item.canonicalUrl, observedAt, observedAt);
    const storedItem = this.database.prepare("SELECT id FROM feed_items WHERE source_id=? AND stable_key=?").get(sourceId, stableKey) as { id: string };
    const contentHash = hash(JSON.stringify([item.canonicalUrl, item.title, item.publishedAt, item.excerpt]));
    const existing = this.database.prepare("SELECT id FROM feed_item_versions WHERE feed_item_id=? AND content_hash=?").get(storedItem.id, contentHash);
    if (existing) return "skipped";

    const versionId = `feed-version-${hash(`${storedItem.id}:${contentHash}`)}`;
    const documentId = `doc-${hash(`${sourceId}:${item.canonicalUrl}:${contentHash}`)}`;
    const documentContentHash = hash(`${item.canonicalUrl}:${contentHash}`);
    this.database.prepare(`INSERT INTO documents (id,source_id,canonical_url,title,published_at,observed_at,content_hash,raw_excerpt)
      VALUES (?,?,?,?,?,?,?,?)`).run(documentId, sourceId, item.canonicalUrl, item.title, item.publishedAt, observedAt, documentContentHash, item.excerpt);
    const evidenceId = `evidence-${hash(`${documentId}:${item.excerpt}`)}`;
    this.database.prepare("INSERT INTO evidence_fragments (id,document_id,quoted_context,fragment_hash) VALUES (?,?,?,?)").run(evidenceId, documentId, item.excerpt, hash(`${documentId}:${item.excerpt}`));
    this.database.prepare(`INSERT INTO feed_item_versions (id,feed_item_id,collection_run_id,content_hash,title,excerpt,published_at,observed_at,document_id)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(versionId, storedItem.id, runId, contentHash, item.title, item.excerpt, item.publishedAt, observedAt, documentId);
    this.database.prepare("UPDATE feed_items SET current_version_id=? WHERE id=?").run(versionId, storedItem.id);
    const classification = classifyDiscoveryCandidate(`${item.title} ${item.excerpt}`);
    this.database.prepare(`INSERT INTO discovery_candidates (id,document_id,matched_track,matched_keywords_json,status,created_at)
      VALUES (?,?,?,?,?,?)`).run(`candidate-${hash(documentId)}`, documentId, classification.track, JSON.stringify(classification.keywords), "pending_entity_resolution", observedAt);
    return "inserted";
  }
}

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
