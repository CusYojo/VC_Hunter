import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import type { WebSearchProvider } from "@/connectors/web-search";
import { IntelligenceDiscoveryRepository } from "@/intelligence/repository";
import { runDueIntelligencePlan } from "@/intelligence/plan-runner";

describe("intelligence plan runner", () => {
  let database: DatabaseSync;
  beforeEach(() => { database = createDatabase(":memory:"); initializeDatabase(database); new IntelligenceDiscoveryRepository(database).listPlans("2026-09-13T00:00:00.000Z"); });
  afterEach(() => database.close());

  it("turns public search results into pending unified candidates without formal ingestion", async () => {
    database.prepare("UPDATE discovery_plans_v2 SET enabled=1,next_run_at='2026-09-13T00:00:00.000Z' WHERE id='venture-tech'").run();
    const provider: WebSearchProvider = { name: "fixture", search: vi.fn().mockResolvedValue({ providerRequestId: "run-1", results: [{ externalId: "lead-1", title: "上海星河芯片完成新融资", url: "https://news.example.com/star-chip", publishedAt: "2026-09-13T01:00:00.000Z", highlights: ["公司完成新一轮融资并扩大研发团队"] }] }) };
    const result = await runDueIntelligencePlan({ database, provider, workerId: "worker-1", now: "2026-09-13T02:00:00.000Z", verifyPublication: async () => "2026-09-13T01:00:00.000Z" });
    expect(result).toMatchObject({ ran: true, failed: false, candidateCount: 1, channel: "venture_tech" });
    expect(new IntelligenceDiscoveryRepository(database).list({}).items[0]).toMatchObject({ name: "上海星河芯片完成新融资", entityType: "company", status: "pending_review", completeness: "L0" });
    expect(database.prepare("SELECT count(*) AS count FROM projects").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT last_status,consecutive_failures FROM discovery_plans_v2 WHERE id='venture-tech'").get()).toEqual({ last_status: "succeeded", consecutive_failures: 0 });
  });

  it("isolates repeated connector failure to the affected channel", async () => {
    database.prepare("UPDATE discovery_plans_v2 SET enabled=1,next_run_at='2026-09-13T00:00:00.000Z',consecutive_failures=2 WHERE id='ranking-award'").run();
    const provider: WebSearchProvider = { name: "fixture", search: vi.fn().mockRejectedValue(new Error("provider down")) };
    const result = await runDueIntelligencePlan({ database, provider, workerId: "worker-1", now: "2026-09-13T02:00:00.000Z" });
    expect(result).toMatchObject({ ran: true, failed: true, channel: "ranking_award" });
    expect(database.prepare("SELECT enabled,last_status,consecutive_failures FROM discovery_plans_v2 WHERE id='ranking-award'").get()).toEqual({ enabled: 0, last_status: "failed", consecutive_failures: 3 });
    expect(database.prepare("SELECT enabled FROM discovery_plans_v2 WHERE id='venture-tech'").get()).toEqual({ enabled: 1 });
  });

  it("uses observation freshness for non-news channels without requiring NewsArticle metadata", async () => {
    database.prepare("UPDATE discovery_plans_v2 SET enabled=0").run();
    database.prepare("UPDATE discovery_plans_v2 SET enabled=1,next_run_at='2026-09-13T00:00:00.000Z' WHERE id='registry'").run();
    const verifyPublication = vi.fn().mockResolvedValue(null);
    const provider: WebSearchProvider = { name: "fixture", search: vi.fn().mockResolvedValue({ providerRequestId: "registry-1", results: [{ externalId: "registry-lead-1", title: "苏州新设半导体企业", url: "https://registry.example.cn/company/1", publishedAt: null, highlights: ["经营范围包含集成电路设计"] }] }) };

    const result = await runDueIntelligencePlan({ database, provider, workerId: "worker-registry", now: "2026-09-13T02:00:00.000Z", verifyPublication });

    expect(result).toMatchObject({ ran: true, failed: false, candidateCount: 1, channel: "registry" });
    expect(verifyPublication).not.toHaveBeenCalled();
    expect(new IntelligenceDiscoveryRepository(database).list({ channel: "registry" }).items[0]).toMatchObject({ eventDate: "2026-09-13" });
  });

  it("creates an update when a monitored URL changes but skips identical observations", async () => {
    database.prepare("UPDATE discovery_plans_v2 SET enabled=0").run();
    database.prepare("UPDATE discovery_plans_v2 SET enabled=1,next_run_at='2026-09-13T00:00:00.000Z' WHERE id='hiring'").run();
    const search = vi.fn()
      .mockResolvedValueOnce({ providerRequestId: "hiring-1", results: [{ externalId: "job-page", title: "星河芯片招聘", url: "https://jobs.example.cn/star", publishedAt: null, highlights: ["研发岗位 10 个"] }] })
      .mockResolvedValueOnce({ providerRequestId: "hiring-2", results: [{ externalId: "job-page", title: "星河芯片招聘", url: "https://jobs.example.cn/star", publishedAt: null, highlights: ["研发岗位 18 个"] }] })
      .mockResolvedValueOnce({ providerRequestId: "hiring-3", results: [{ externalId: "job-page", title: "星河芯片招聘", url: "https://jobs.example.cn/star", publishedAt: null, highlights: ["研发岗位 18 个"] }] });
    const provider: WebSearchProvider = { name: "fixture", search };

    expect((await runDueIntelligencePlan({ database, provider, workerId: "hiring-1", now: "2026-09-13T02:00:00.000Z" })).candidateCount).toBe(1);
    database.prepare("UPDATE discovery_plans_v2 SET next_run_at='2026-09-14T00:00:00.000Z' WHERE id='hiring'").run();
    expect((await runDueIntelligencePlan({ database, provider, workerId: "hiring-2", now: "2026-09-14T02:00:00.000Z" })).candidateCount).toBe(1);
    database.prepare("UPDATE discovery_plans_v2 SET next_run_at='2026-09-15T00:00:00.000Z' WHERE id='hiring'").run();
    expect((await runDueIntelligencePlan({ database, provider, workerId: "hiring-3", now: "2026-09-15T02:00:00.000Z" })).candidateCount).toBe(0);
    expect(new IntelligenceDiscoveryRepository(database).list({ channel: "hiring" }).total).toBe(2);
  });
});
