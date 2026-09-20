import type { DatabaseSync } from "node:sqlite";
import type { InvestmentEventSummary, RoundLabel, Track } from "@/domain/types";
import { TRACK_VALUES } from "@/domain/types";

/**
 * 市场投融资看板：对 `investment_events` / `ma_events` 做时间窗口聚合。
 *
 * 金额只在同币种内求和，不做汇率换算——未披露金额保持 null 并单独计数，
 * 与"未披露字段不填零"的约束一致。
 */

const DEFAULT_WINDOW_DAYS = 90;
const MAX_WINDOW_DAYS = 730;
const LATEST_EVENT_LIMIT = 20;
const ACTIVE_INVESTOR_LIMIT = 10;
const MONTHLY_BUCKETS = 12;
const DAY_MS = 86_400_000;

export interface FundingDashboardView {
  asOf: string;
  windowDays: number;
  totals: { events: number; disclosedCny: number; disclosedUsd: number; undisclosed: number; maEvents: number };
  byTrack: Array<{ track: Track; events: number; amountCny: number; leadInvestors: string[] }>;
  byRound: Array<{ round: RoundLabel; events: number }>;
  monthly: Array<{ month: string; events: number; amountCny: number }>;
  activeInvestors: Array<{ investorId: string; name: string; events: number; leadCount: number; status: string | null }>;
  latestEvents: InvestmentEventSummary[];
}

type Row = Record<string, string | number | null>;

export function buildFundingDashboard(database: DatabaseSync, options: { windowDays?: number; asOf?: Date } = {}): FundingDashboardView {
  const asOf = options.asOf ?? new Date();
  const windowDays = Math.min(Math.max(options.windowDays ?? DEFAULT_WINDOW_DAYS, 7), MAX_WINDOW_DAYS);
  const since = new Date(asOf.getTime() - windowDays * DAY_MS).toISOString().slice(0, 10);
  const events = loadEvents(database, since);
  const investorNames = loadInvestorNames(database);

  const byTrackMap = new Map<Track, { events: number; amountCny: number; leadInvestors: Set<string> }>();
  const byRoundMap = new Map<RoundLabel, number>();
  const investorMap = new Map<string, { events: number; leadCount: number }>();
  let disclosedCny = 0;
  let disclosedUsd = 0;
  let undisclosed = 0;
  for (const event of events) {
    const track = byTrackMap.get(event.track) ?? { events: 0, amountCny: 0, leadInvestors: new Set<string>() };
    track.events += 1;
    if (event.amount !== null && event.currency === "CNY") { track.amountCny += event.amount; disclosedCny += event.amount; }
    else if (event.amount !== null && event.currency === "USD") disclosedUsd += event.amount;
    else undisclosed += 1;
    for (const lead of event.leadInvestors) track.leadInvestors.add(investorNames.get(lead)?.name ?? lead);
    byTrackMap.set(event.track, track);
    byRoundMap.set(event.round, (byRoundMap.get(event.round) ?? 0) + 1);
    for (const investor of event.investors) {
      const entry = investorMap.get(investor) ?? { events: 0, leadCount: 0 };
      entry.events += 1;
      if (event.leadInvestors.includes(investor)) entry.leadCount += 1;
      investorMap.set(investor, entry);
    }
  }

  const maEvents = Number((database.prepare("SELECT count(*) AS count FROM ma_events WHERE announcement_date >= ?").get(since) as { count: number }).count);
  return {
    asOf: asOf.toISOString(),
    windowDays,
    totals: { events: events.length, disclosedCny, disclosedUsd, undisclosed, maEvents },
    byTrack: TRACK_VALUES.map((track) => {
      const entry = byTrackMap.get(track);
      return { track, events: entry?.events ?? 0, amountCny: entry?.amountCny ?? 0, leadInvestors: entry ? Array.from(entry.leadInvestors) : [] };
    }).sort((left, right) => right.events - left.events || right.amountCny - left.amountCny),
    byRound: Array.from(byRoundMap.entries()).map(([round, count]) => ({ round, events: count })).sort((left, right) => right.events - left.events),
    monthly: buildMonthly(database, asOf),
    activeInvestors: Array.from(investorMap.entries())
      .map(([investorId, entry]) => ({ investorId, name: investorNames.get(investorId)?.name ?? investorId, status: investorNames.get(investorId)?.status ?? null, ...entry }))
      .sort((left, right) => right.events - left.events || right.leadCount - left.leadCount || left.name.localeCompare(right.name, "zh-CN"))
      .slice(0, ACTIVE_INVESTOR_LIMIT),
    latestEvents: events.slice(0, LATEST_EVENT_LIMIT),
  };
}

function loadEvents(database: DatabaseSync, since: string): InvestmentEventSummary[] {
  const rows = database.prepare(`SELECT ie.*, c.legal_name AS company_name, c.id AS company_id,
      (SELECT p.track FROM projects p WHERE p.company_id = c.id LIMIT 1) AS track
    FROM investment_events ie JOIN companies c ON c.id = ie.company_id
    WHERE ie.announced_at >= ?
    ORDER BY ie.announced_at DESC, ie.id DESC`).all(since) as unknown as Row[];
  return rows.map((row) => ({
    id: String(row.id),
    companyId: String(row.company_id),
    companyName: String(row.company_name),
    track: (row.track ? String(row.track) : "AI") as Track,
    round: String(row.round) as RoundLabel,
    announcedAt: String(row.announced_at),
    amount: row.amount === null ? null : Number(row.amount),
    currency: row.currency ? (String(row.currency) as "CNY" | "USD") : null,
    disclosureType: String(row.disclosure_type) as InvestmentEventSummary["disclosureType"],
    investors: JSON.parse(String(row.investors_json)) as string[],
    leadInvestors: JSON.parse(String(row.lead_investors_json)) as string[],
    confidence: Number(row.confidence),
  }));
}

function loadInvestorNames(database: DatabaseSync): Map<string, { name: string; status: string }> {
  const rows = database.prepare("SELECT id, name, aliases_json, status FROM investors").all() as unknown as Row[];
  const map = new Map<string, { name: string; status: string }>();
  for (const row of rows) {
    const entry = { name: String(row.name), status: String(row.status ?? "seed_candidate") };
    map.set(String(row.id), entry);
    map.set(String(row.name), entry);
    for (const alias of JSON.parse(String(row.aliases_json ?? "[]")) as string[]) map.set(alias, entry);
  }
  return map;
}

function buildMonthly(database: DatabaseSync, asOf: Date): FundingDashboardView["monthly"] {
  const start = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - (MONTHLY_BUCKETS - 1), 1));
  const rows = database.prepare(`SELECT substr(announced_at, 1, 7) AS month, count(*) AS events,
      COALESCE(SUM(CASE WHEN currency = 'CNY' THEN amount ELSE 0 END), 0) AS amount_cny
    FROM investment_events WHERE announced_at >= ? GROUP BY month ORDER BY month`).all(start.toISOString().slice(0, 10)) as unknown as Row[];
  const byMonth = new Map(rows.map((row) => [String(row.month), { events: Number(row.events), amountCny: Number(row.amount_cny) }]));
  return Array.from({ length: MONTHLY_BUCKETS }, (_, index) => {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1));
    const month = date.toISOString().slice(0, 7);
    return { month, events: byMonth.get(month)?.events ?? 0, amountCny: byMonth.get(month)?.amountCny ?? 0 };
  });
}
