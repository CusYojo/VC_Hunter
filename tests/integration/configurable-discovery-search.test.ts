import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import type { WebSearchProvider } from "@/connectors/web-search";
import { SqliteWebSearchRepository } from "@/repositories/web-search";
import { discoverWebLeads } from "@/services/web-search";
import { discoveryJobInputSchema } from "@/workbench/contracts";

describe("configurable discovery search", () => {
  let database: DatabaseSync;
  beforeEach(() => { database = createDatabase(":memory:"); initializeDatabase(database); });
  afterEach(() => database.close());

  it("keeps legacy job inputs compatible while adding channel, query-family and scope fields", () => {
    expect(discoveryJobInputSchema.parse({ query: "半导体融资" })).toMatchObject({ channel: "venture_tech", queryFamily: "manual", cities: [], subtracks: [], dateWindowDays: 1, preferredDomains: [], sourceScope: "approved_public" });
    expect(discoveryJobInputSchema.parse({ query: "研发招聘增长", channel: "hiring", queryFamily: "hiring-growth", cities: ["深圳"], subtracks: ["机器人"], dateWindowDays: 14, preferredDomains: ["careers.example.com"], sourceScope: "licensed_internal" })).toMatchObject({ channel: "hiring", cities: ["深圳"], dateWindowDays: 14 });
  });

  it("passes a custom date window and preferred domains to the provider", async () => {
    const search = vi.fn().mockResolvedValue({ providerRequestId: "configured", results: [{ externalId: "award", title: "科技奖项", url: "https://awards.example.com/2026", publishedAt: "2026-09-10T02:00:00.000Z", highlights: ["公布获奖名单"] }] });
    const provider: WebSearchProvider = { name: "fixture", search };
    await discoverWebLeads(new SqliteWebSearchRepository(database), provider, {
      query: "科技奖项 AI", limit: 10, traceId: "configured", observedAt: "2026-09-14T03:00:00.000Z", channel: "ranking_award", dateWindowDays: 7, preferredDomains: ["awards.example.com"], cities: ["北京", "上海"], subtracks: ["多模态"], queryFamily: "award-talent",
    }, async () => "2026-09-10T02:00:00.000Z");
    expect(search).toHaveBeenCalledWith(expect.objectContaining({
      query: "科技奖项 AI", preferredDomains: ["awards.example.com"], searchContext: expect.objectContaining({ channel: "ranking_award", cities: ["北京", "上海"], subtracks: ["多模态"], queryFamily: "award-talent" }),
      publicationWindow: { start: "2026-09-07T03:00:00.000Z", end: "2026-09-14T03:00:00.001Z" },
    }));
    expect(database.prepare("SELECT count(*) AS count FROM web_search_leads").get()).toEqual({ count: 1 });
  });
});
