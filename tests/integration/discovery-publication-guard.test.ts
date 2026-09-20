import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { SqliteBackgroundAgentRepository } from "@/repositories/background-agent";
import { SqliteWorkbenchRepository } from "@/workbench/repository";
import { runBackgroundAgentCycle, syncAgentManifest } from "@/services/background-agent";
import { readDiscoverySchedule, updateDiscoverySchedule } from "@/services/discovery-schedule";
vi.mock("@/connectors/news-publication-verifier", () => ({ verifyNewsPublication: vi.fn(async () => "2026-09-04T00:00:00.000Z") }));
const now = "2026-09-04T02:00:00.000Z";
let db: DatabaseSync;
beforeEach(() => { db = createDatabase(":memory:"); initializeDatabase(db); });
afterEach(() => db.close());
const assessment = (leadId: string) => ({ leadId, relevant: true, companyName: leadId, track: "AI" as const, investorNames: [], signalType: "funding" as const, summary: "融资新闻", confidence: 0.9 });
function lead(id: string, publishedAt: string | null, verifiedAt: string | null = now) {
  db.prepare("INSERT INTO web_search_leads(id,url,title,published_at,highlights_json,first_seen_at,last_seen_at,status,publication_verified_at) VALUES (?,?,?,?,'[]',?,?,'discovered',?)").run(id, `https://news.test/${id}`, id, publishedAt, now, now, verifiedAt);
}
it("checks publication dates again at persistence and rejects unknown, missing, old and future source dates", () => {
  lead("today", "2026-09-04"); lead("midnight", "2026-09-03T16:00:00Z"); lead("yesterday", "2026-09-03T15:59:59Z"); lead("future", "2026-09-04T03:00:00Z"); lead("unknown", null); lead("invalid", "yesterday");
  const count = new SqliteBackgroundAgentRepository(db).persistQualifiedCandidates(["today", "midnight", "yesterday", "future", "unknown", "invalid", "invented"].map(assessment), now, "guard");
  expect(count).toBe(2);
  expect(db.prepare("SELECT lead_id FROM project_candidates ORDER BY lead_id").all().map(row => row.lead_id)).toEqual(["midnight", "today"]);
});
it.each(["scheduled", "on-demand"])("%s qualification can only persist leads returned by its own search run", async mode => {
  lead("outside-current-run", "2026-09-04");
  const url = "https://news.test/current";
  const currentId = `web-lead-${createHash("sha256").update(url).digest("hex")}`;
  if (mode === "scheduled") {
    syncAgentManifest(db, { searchPlans: [{ id: "daily-ai", name: "今日新闻", query: "AI 融资", intervalMinutes: 1440, limit: 10, enabled: true }] }, now);
    const schedule = readDiscoverySchedule(db, now);
    updateDiscoverySchedule(db, { enabled: true, version: schedule.version }, "admin", new Date(Date.parse(now) - 1).toISOString());
  } else new SqliteWorkbenchRepository(db).createDiscoveryJob({ query: "AI 融资", resultLimit: 10 }, "today", "tester");
  const qualifyDiscoveryLeads = vi.fn().mockResolvedValue([assessment(currentId), assessment("outside-current-run")]);
  const result = await runBackgroundAgentCycle({ repository: new SqliteBackgroundAgentRepository(db), searchProvider: { name: "exa", search: vi.fn().mockResolvedValue({ providerRequestId: "current", results: [{ externalId: "current", title: "今日 AI 融资", url, publishedAt: "2026-09-04", highlights: [] }] }) }, researchGateway: { generateResearchBrief: vi.fn(), qualifyDiscoveryLeads }, workerId: "guard", now });
  expect(result.failures).toBe(0);
  expect(qualifyDiscoveryLeads).toHaveBeenCalledOnce();
  expect(db.prepare("SELECT lead_id FROM project_candidates").all().map(row => row.lead_id)).toEqual([currentId]);
});
it("requires original-page verification before persisting an otherwise current news source", () => {
  lead("unchecked", "2026-09-04", null);
  expect(new SqliteBackgroundAgentRepository(db).persistQualifiedCandidates([assessment("unchecked")], now, "unverified")).toBe(0);
});
