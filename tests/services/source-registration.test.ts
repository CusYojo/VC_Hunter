import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { syncSourceManifest, type SourceManifest } from "@/services/source-registration";

describe("versioned source manifest", () => {
  let database: DatabaseSync;
  beforeEach(() => { database = createDatabase(":memory:"); initializeDatabase(database); });
  afterEach(() => database.close());

  it("registers an approved but disabled feed with an exact host policy", () => {
    const manifest: SourceManifest = { sources: [{
      id: "source-official",
      name: "官方公告 RSS",
      type: "official_feed",
      authority: "A",
      robotsStatus: "allowed",
      licenseNotes: "内部事实抽取；不对外转载全文。",
      policyStatus: "approved",
      independentGroup: "official-example",
      channel: "venture_tech",
      connectorType: "rss",
      accessClass: "public",
      allowedStorage: "metadata_excerpt",
      allowExternalModel: true,
      frequencyLimit: "每小时最多一次",
      termsReviewStatus: "reviewed",
      credentialRef: null,
      feed: { endpointUrl: "https://feeds.example.cn/news.xml", allowedHostname: "feeds.example.cn", enabled: false },
    }] };
    syncSourceManifest(database, manifest);

    expect(database.prepare("SELECT policy_status,access_mode FROM sources WHERE id=?").get("source-official")).toMatchObject({ policy_status: "approved", access_mode: "rss" });
    expect(database.prepare("SELECT channel,connector_type,access_class,allowed_storage,allow_external_model,frequency_limit,terms_review_status,credential_ref FROM sources WHERE id=?").get("source-official")).toEqual({ channel: "venture_tech", connector_type: "rss", access_class: "public", allowed_storage: "metadata_excerpt", allow_external_model: 1, frequency_limit: "每小时最多一次", terms_review_status: "reviewed", credential_ref: null });
    expect(database.prepare("SELECT enabled,allowed_hostname FROM source_feeds WHERE source_id=?").get("source-official")).toMatchObject({ enabled: 0, allowed_hostname: "feeds.example.cn" });

    database.prepare("UPDATE source_feeds SET etag='old',last_modified='yesterday',last_success_at='yesterday' WHERE source_id=?").run("source-official");
    syncSourceManifest(database, manifest);
    expect(database.prepare("SELECT config_version,etag FROM source_feeds WHERE source_id=?").get("source-official")).toMatchObject({ config_version: 1, etag: "old" });

    syncSourceManifest(database, { sources: [{ ...manifest.sources[0], feed: { ...manifest.sources[0].feed!, endpointUrl: "https://feeds.example.cn/releases.xml" } }] });
    expect(database.prepare("SELECT config_version,etag,last_modified,last_success_at FROM source_feeds WHERE source_id=?").get("source-official")).toMatchObject({ config_version: 2, etag: null, last_modified: null, last_success_at: null });
  });

  it("rejects a manifest whose URL escapes the approved hostname", () => {
    expect(() => syncSourceManifest(database, { sources: [{
      id: "bad-source", name: "bad", type: "feed", authority: "B", robotsStatus: "unknown", licenseNotes: "reviewed", policyStatus: "approved", independentGroup: "bad",
      channel: "venture_tech", connectorType: "rss", accessClass: "public", allowedStorage: "metadata_excerpt", allowExternalModel: false, frequencyLimit: null, termsReviewStatus: "reviewed", credentialRef: null,
      feed: { endpointUrl: "https://evil.example/feed.xml", allowedHostname: "feeds.example.cn", enabled: false },
    }] })).toThrow(/hostname/i);
  });

  it("defaults omitted compliance fields to a fail-closed policy and rejects unknown manifest keys", () => {
    const incomplete = { sources: [{ id: "source-incomplete", name: "不完整来源", type: "media", authority: "B", robotsStatus: "allowed", licenseNotes: "待复核来源条款", policyStatus: "approved", independentGroup: "group" }] };
    expect(syncSourceManifest(database, incomplete as SourceManifest)).toEqual({ synced: 1 });
    expect(database.prepare("SELECT access_class,allowed_storage,allow_external_model,terms_review_status FROM sources WHERE id='source-incomplete'").get()).toEqual({ access_class: "user_supplied", allowed_storage: "metadata_only", allow_external_model: 0, terms_review_status: "pending" });
    expect(() => syncSourceManifest(database, { sources: [{ ...incomplete.sources[0], channel: "venture_tech", connectorType: "manual", accessClass: "public", allowedStorage: "metadata_only", allowExternalModel: false, frequencyLimit: null, termsReviewStatus: "pending", credentialRef: null, unexpected: true }] } as unknown as SourceManifest)).toThrow();
  });

  it("accepts one human-readable manifest comment but still rejects other top-level keys", () => {
    expect(syncSourceManifest(database, {
      $comment: "启用前完成来源条款审核。",
      sources: [],
    })).toEqual({ synced: 0 });

    expect(() => syncSourceManifest(database, {
      $comment: "启用前完成来源条款审核。",
      sources: [],
      unexpected: true,
    } as unknown as SourceManifest)).toThrow();
  });
});
