import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import { SqliteBackgroundAgentRepository } from "@/repositories/background-agent";
import { runBackgroundAgentCycle } from "@/services/background-agent";
import { SqliteWorkbenchRepository } from "@/workbench/repository";

vi.mock("@/connectors/news-publication-verifier", () => ({ verifyNewsPublication: vi.fn(async () => "2026-09-02T00:00:00.000Z") }));

describe("workbench background orchestration", () => {
  let database: DatabaseSync;
  beforeEach(() => { database = createDatabase(":memory:"); initializeDatabase(database); seedDemoData(database); });
  afterEach(() => database.close());

  it("claims one on-demand discovery job after scheduled search", async () => {
    new SqliteWorkbenchRepository(database).createDiscoveryJob({ query: "红杉中国 半导体 新投资", tracks: ["半导体"], institutions: ["红杉中国"], resultLimit: 10 }, "discovery-bg-1", "user-demo");
    const search = vi.fn().mockResolvedValue({ providerRequestId: "request-1", results: [{ externalId: "r1", title: "红杉中国投资星河芯片", url: "https://example.com/star", publishedAt: "2026-09-02T00:00:00.000Z", highlights: ["红杉中国投资星河芯片，项目从事先进封装。"] }] });
    const qualifyDiscoveryLeads = vi.fn().mockImplementation(async ({ leads }) => leads.map((lead: { id: string }) => ({ leadId: lead.id, relevant: true, companyName: "星河芯片", track: "半导体", investorNames: ["红杉中国"], signalType: "investment", summary: "红杉中国投资星河芯片。", confidence: 0.9 })));
    const result = await runBackgroundAgentCycle({ repository: new SqliteBackgroundAgentRepository(database), searchProvider: { name: "deepseek-web-search", search }, researchGateway: { qualifyDiscoveryLeads, generateResearchBrief: vi.fn() }, workerId: "worker-1", now: "2026-09-02T03:00:00.000Z" });
    expect(result).toMatchObject({ searchRuns: 0, discoveryRuns: 1, researchRuns: 0, documentRuns: 0, failures: 0 });
    expect(database.prepare("SELECT status,attempt_count FROM discovery_jobs").get()).toEqual({ status: "succeeded", attempt_count: 1 });
    expect(database.prepare("SELECT status,company_name FROM project_candidates").get()).toEqual({ status: "pending_review", company_name: "星河芯片" });
    expect(database.prepare("SELECT workflow_version,trigger_type,status FROM workflow_runs WHERE trigger_type='on_demand_discovery'").get()).toEqual({ workflow_version: "1.1.0", trigger_type: "on_demand_discovery", status: "succeeded" });
  });
});
