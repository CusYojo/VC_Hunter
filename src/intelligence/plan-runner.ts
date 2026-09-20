import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { WebSearchProvider } from "@/connectors/web-search";
import { SqliteWebSearchRepository } from "@/repositories/web-search";
import { discoverWebLeads } from "@/services/web-search";
import { TRACKS, type DiscoveryChannel, type Track } from "./contracts";
import { IntelligenceDiscoveryRepository } from "./repository";
import { nextIntelligencePlanRun, type IntelligenceSchedule } from "./scheduling";

interface PlanRow {
  id: string; name: string; channel: Exclude<DiscoveryChannel, "manual_codex">; query_family: string; tracks_json: string;
  subtracks_json: string; cities_json: string; preferred_domains_json: string; date_window_days: number;
  connector_type: "public_search" | "rss" | "licensed_api"; schedule_json: string; consecutive_failures: number;
}

export async function runDueIntelligencePlan(input: { database: DatabaseSync; provider: WebSearchProvider; workerId: string; now?: string; verifyPublication?: (url: string) => Promise<string | null> }): Promise<{ ran: boolean; failed: boolean; candidateCount: number; channel: string | null }> {
  const now = input.now ?? new Date().toISOString();
  const plan = claimPlan(input.database, input.workerId, now);
  if (!plan) return { ran: false, failed: false, candidateCount: 0, channel: null };
  const schedule = JSON.parse(plan.schedule_json) as IntelligenceSchedule;
  try {
    if (plan.connector_type === "licensed_api") throw new Error("LICENSED_CONNECTOR_DISABLED");
    const tracks = JSON.parse(plan.tracks_json) as Track[];
    const subtracks = JSON.parse(plan.subtracks_json) as string[];
    const cities = JSON.parse(plan.cities_json) as string[];
    const preferredDomains = JSON.parse(plan.preferred_domains_json) as string[];
    const query = buildQuery(plan.query_family, tracks, subtracks, cities);
    const webRepository = new SqliteWebSearchRepository(input.database);
    const receipt = await discoverWebLeads(webRepository, input.provider, { query, limit: 20, traceId: randomUUID(), observedAt: now, channel: plan.channel, queryFamily: plan.query_family, cities, subtracks, dateWindowDays: plan.date_window_days, preferredDomains }, input.verifyPublication);
    const leads = webRepository.listRunLeads(receipt.runId);
    const repository = new IntelligenceDiscoveryRepository(input.database);
    let candidateCount = 0;
    for (const lead of leads) {
      const publication = input.database.prepare("SELECT published_at FROM web_search_leads WHERE id=?").get(lead.id) as { published_at: string | null } | undefined;
      const track = inferTrack(`${lead.title} ${lead.highlights.join(" ")}`, tracks);
      const highlight = lead.highlights[0] ?? lead.title;
      const contentHash = createHash("sha256").update(`${lead.url}\n${highlight}`).digest("hex");
      const exists = input.database.prepare("SELECT 1 FROM intelligence_candidate_sources WHERE url=? AND content_hash=? LIMIT 1").get(lead.url, contentHash);
      if (exists) continue;
      const entityType = inferEntityType(plan.channel, lead.title);
      repository.create({
        externalId: `monitor:${plan.id}:${contentHash}`, entityType, candidateKind: "new_entity", name: lead.title, track,
        subtrack: subtracks[0] ?? null, city: inferCity(lead.title, cities), signalType: plan.channel === "hiring" ? "hiring_observation" : plan.channel === "ranking_award" ? "ranking_or_award_page" : plan.channel === "registry" ? "registry_observation" : "public_signal",
        eventDate: (publication?.published_at ?? now).slice(0, 10), channel: plan.channel, discoveryReason: highlight,
        investmentSummary: "", investmentHighlights: [], openQuestions: ["主体身份、核心团队、技术差异与商业验证仍需交叉核验。"],
        scores: { technology: 1, team: 1, commercial: 1, signal: 3, evidence: 2 },
        evidence: [{ ref: "public-search", title: lead.title, url: lead.url, publishedAt: publication?.published_at ?? null, observedAt: now, excerpt: highlight, authority: "C", accessClass: "public", collectionMethod: "web_search", allowExternalModel: true }],
        assertions: [{ field: "discoverySignal", label: "发现信号", valueStatus: "known", epistemicType: "fact", value: highlight, confidence: 0.65, evidenceRefs: ["public-search"] }], relationships: [], contacts: [],
      }, { actorId: "background-agent", idempotencyKey: `monitor:${plan.id}:${contentHash}`, now });
      candidateCount += 1;
    }
    completePlan(input.database, plan, input.workerId, now);
    return { ran: true, failed: false, candidateCount, channel: plan.channel };
  } catch {
    failPlan(input.database, plan, input.workerId, now, schedule);
    return { ran: true, failed: true, candidateCount: 0, channel: plan.channel };
  }
}

function claimPlan(database: DatabaseSync, workerId: string, now: string): PlanRow | undefined {
  database.exec("BEGIN IMMEDIATE");
  try {
    const row = database.prepare(`SELECT * FROM discovery_plans_v2 WHERE enabled=1 AND next_run_at<=? AND (lease_until IS NULL OR lease_until<=?) ORDER BY next_run_at,id LIMIT 1`).get(now, now) as unknown as PlanRow | undefined;
    if (!row) { database.exec("COMMIT"); return undefined; }
    const claimed = database.prepare("UPDATE discovery_plans_v2 SET lease_owner=?,lease_until=?,last_started_at=? WHERE id=? AND (lease_until IS NULL OR lease_until<=?)")
      .run(workerId, new Date(Date.parse(now) + 300_000).toISOString(), now, row.id, now);
    if (Number(claimed.changes) !== 1) { database.exec("COMMIT"); return undefined; }
    database.exec("COMMIT"); return row;
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}

function completePlan(database: DatabaseSync, plan: PlanRow, workerId: string, now: string): void {
  const next = nextIntelligencePlanRun(JSON.parse(plan.schedule_json) as IntelligenceSchedule, now, now);
  database.prepare("UPDATE discovery_plans_v2 SET lease_owner=NULL,lease_until=NULL,last_finished_at=?,last_status='succeeded',last_error_code=NULL,consecutive_failures=0,next_run_at=?,updated_at=? WHERE id=? AND lease_owner=?")
    .run(now, next, now, plan.id, workerId);
}
function failPlan(database: DatabaseSync, plan: PlanRow, workerId: string, now: string, schedule: IntelligenceSchedule): void {
  const failures = Number(plan.consecutive_failures) + 1;
  const next = nextIntelligencePlanRun(schedule, now, now);
  database.prepare("UPDATE discovery_plans_v2 SET enabled=?,lease_owner=NULL,lease_until=NULL,last_finished_at=?,last_status='failed',last_error_code='COLLECTION_FAILED',consecutive_failures=?,next_run_at=?,updated_at=? WHERE id=? AND lease_owner=?")
    .run(failures >= 3 ? 0 : 1, now, failures, next, now, plan.id, workerId);
}
function buildQuery(family: string, tracks: readonly string[], subtracks: readonly string[], cities: readonly string[]): string { return [family, tracks.join(" OR "), subtracks.join(" OR "), cities.join(" OR ")].filter(Boolean).join(" ").slice(0, 1_000); }
function inferTrack(text: string, configured: readonly Track[]): Track { return TRACKS.find((track) => text.includes(track)) ?? configured[0] ?? "AI"; }
function inferCity(text: string, cities: readonly string[]): string | null { return cities.find((city) => text.includes(city)) ?? null; }
function inferEntityType(channel: PlanRow["channel"], title: string): "company" | "person" | "technology" { if (channel !== "ranking_award") return "company"; return /技术|成果|专利|论文|工艺|材料/u.test(title) ? "technology" : "person"; }
