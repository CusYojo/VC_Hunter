import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import type { WebSearchProvider } from "@/connectors/web-search";
import { SqliteWebSearchRepository } from "@/repositories/web-search";
import { discoverWebLeads } from "@/services/web-search";
import { listWebSearchLeads } from "@/repositories/dashboard-data";

describe("web lead discovery", () => {
  let database: DatabaseSync;
  beforeEach(() => { database = createDatabase(":memory:"); initializeDatabase(database); });
  afterEach(() => database.close());

  it("stores search results as discovery leads, not verified evidence, idempotently", async () => {
    const provider: WebSearchProvider = { name: "exa", search: vi.fn().mockResolvedValue({ providerRequestId: "provider-1", results: [
      { externalId: "a", title: "半导体融资线索", url: "https://company.example/a", publishedAt: "2026-08-31T00:00:00.000Z", highlights: ["宣布完成融资"] },
      { externalId: "b", title: "火箭试验线索", url: "https://space.example/b", publishedAt: "2026-08-31T00:00:00.000Z", highlights: ["完成热试"] },
    ] }) };
    const repository = new SqliteWebSearchRepository(database);

    const first = await discoverWebLeads(repository, provider, { query: "硬科技 新进展", limit: 10, traceId: "search-trace-1", observedAt: "2026-08-31T01:00:00.000Z" }, async () => "2026-08-31T00:00:00.000Z");
    const second = await discoverWebLeads(repository, provider, { query: "硬科技 新进展", limit: 10, traceId: "search-trace-2", observedAt: "2026-08-31T02:00:00.000Z" }, async () => "2026-08-31T00:00:00.000Z");

    expect(first).toMatchObject({ insertedCount: 2, skippedCount: 0 });
    expect(second).toMatchObject({ insertedCount: 0, skippedCount: 2 });
    expect(database.prepare("SELECT count(*) AS count FROM web_search_leads").get()).toMatchObject({ count: 2 });
    expect(database.prepare("SELECT count(*) AS count FROM web_search_runs").get()).toMatchObject({ count: 2 });
    expect(database.prepare("SELECT count(*) AS count FROM evidence_fragments").get()).toMatchObject({ count: 0 });
    expect(listWebSearchLeads(database)).toHaveLength(2);
  });
});
