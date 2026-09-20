import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { SqliteWebSearchRepository } from "@/repositories/web-search";
import { discoverWebLeads } from "@/services/web-search";

describe("same-day news discovery", () => {
  let database: DatabaseSync;
  beforeEach(() => { database = createDatabase(":memory:"); initializeDatabase(database); });
  afterEach(() => database.close());
  it("filters historical, undated, invalid and future news before storage or qualification", async () => {
    const dates = ["2026-09-03T16:00:00.000Z", "2026-09-04T00:30:00+08:00", "2026-09-04", "2026-09-03T15:59:59.999Z", null, "yesterday", "2026-09-04T16:00:00.000Z", "2026-09-04T09:00:00.000Z"];
    const search = vi.fn().mockResolvedValue({ providerRequestId: "news", results: dates.map((publishedAt, i) => ({ externalId: String(i), title: `新闻${i}`, url: `https://news.example/${i}`, publishedAt, highlights: ["报道"] })) });
    const receipt = await discoverWebLeads(new SqliteWebSearchRepository(database), { name: "fixture", search }, { query: "融资新闻", limit: 10, traceId: "today", observedAt: "2026-09-04T02:00:00.000Z" }, async () => "2026-09-04T00:00:00.000Z");
    expect(receipt.resultCount).toBe(3);
    expect(database.prepare("SELECT title FROM web_search_leads ORDER BY title").all()).toEqual([{ title: "新闻0" }, { title: "新闻1" }, { title: "新闻2" }]);
    expect(search).toHaveBeenCalledWith({ query: "融资新闻", limit: 10, publicationWindow: { start: "2026-09-03T16:00:00.000Z", end: "2026-09-04T16:00:00.000Z" }, preferredDomains: ["chinaventure.com.cn", "36kr.com"] });
  });
  it("succeeds with zero leads when only stale news is returned", async () => {
    const search = vi.fn().mockResolvedValue({ providerRequestId: "old", results: [{ externalId: "old", title: "旧新闻", url: "https://news.example/old", publishedAt: "2025-09-04", highlights: [] }] });
    const receipt = await discoverWebLeads(new SqliteWebSearchRepository(database), { name: "fixture", search }, { query: "融资新闻", limit: 5, traceId: "empty", observedAt: "2026-09-04T02:00:00.000Z" }, async () => "2026-09-04T00:00:00.000Z");
    expect(receipt).toMatchObject({ resultCount: 0, insertedCount: 0 });
    expect(database.prepare("SELECT status FROM web_search_runs WHERE id=?").get(receipt.runId)).toEqual({ status: "succeeded" });
  });
  it("rejects a model's invented today date when the original article is old, updated-only or unavailable", async () => {
    const results = ["old", "unknown", "current"].map(id => ({ externalId: id, title: id, url: `https://news.example/${id}`, publishedAt: "2026-09-04T01:00:00Z", highlights: [] }));
    const search = vi.fn().mockResolvedValue({ providerRequestId: "claimed-today", results });
    const verify = vi.fn(async (url: string) => url.endsWith("old") ? "2025-09-04T00:00:00Z" : url.endsWith("current") ? "2026-09-04T00:30:00Z" : null);
    const receipt = await discoverWebLeads(new SqliteWebSearchRepository(database), { name: "fixture", search }, { query: "融资新闻", limit: 5, traceId: "verify-original", observedAt: "2026-09-04T02:00:00.000Z" }, verify);
    expect(receipt.resultCount).toBe(1);
    expect(database.prepare("SELECT title,published_at,publication_verified_at FROM web_search_leads").all()).toEqual([{ title: "current", published_at: "2026-09-04T00:30:00.000Z", publication_verified_at: "2026-09-04T02:00:00.000Z" }]);
  });

});
