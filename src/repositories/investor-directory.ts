import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  InstitutionType,
  InvestmentEventSummary,
  InvestorPriority,
  InvestorStatus,
  InvestorSummary,
  InvestorType,
  Track,
} from "@/domain/types";

/**
 * 头部硬科技机构名录：读取、筛选、增改与批量导入。
 *
 * 名录与 `investment_events` 通过 `investors_json` 中的机构 id / 名称 / 别名关联，
 * 因此"过往投资历史"不需要额外关联表，导入时也不会破坏既有事件。
 */

type Row = Record<string, string | number | null>;

export interface InvestorDirectoryFilters {
  status?: InvestorStatus | "all";
  institutionType?: InstitutionType | "all";
  track?: Track | "all";
  priority?: InvestorPriority | "all";
  query?: string;
  page?: number;
  perPage?: number;
}

export interface InvestorWriteInput {
  name: string;
  englishName?: string | null;
  aliases?: string[];
  institutionType: InstitutionType;
  headquarters?: string | null;
  focusTracks: Track[];
  subtracks?: string[];
  stageFocus?: string[];
  investmentStyle?: string | null;
  thesis?: string | null;
  keyPeople?: InvestorSummary["keyPeople"];
  portfolioSample?: InvestorSummary["portfolioSample"];
  fundSize?: InvestorSummary["fundSize"];
  sourceRefs?: string[];
  status?: InvestorStatus;
  priority?: InvestorPriority;
  rank?: number | null;
  verification?: InvestorSummary["verification"];
  notes?: string;
  trackPerformance?: InvestorSummary["trackPerformance"];
  extra?: Record<string, string>;
}

export interface InvestorDetail extends InvestorSummary {
  investmentHistory: InvestmentEventSummary[];
  extra: Record<string, string>;
}

const DEFAULT_PER_PAGE = 50;
const MAX_PER_PAGE = 500;

/** 旧 `type` 列只为兼容保留；名录以 `institution_type` 为准。 */
export function legacyInvestorType(institutionType: InstitutionType): InvestorType {
  if (institutionType === "financial_vc") return "vc";
  if (institutionType === "local_government" || institutionType === "national_fund") return "government_fund";
  return institutionType;
}

export function mapInvestorRow(row: Row, portfolioCount: number): InvestorSummary {
  return {
    id: String(row.id),
    name: String(row.name),
    englishName: row.english_name ? String(row.english_name) : null,
    aliases: parseJson<string[]>(row.aliases_json, []),
    type: String(row.type) as InvestorType,
    institutionType: String(row.institution_type ?? "financial_vc") as InstitutionType,
    headquarters: row.headquarters ? String(row.headquarters) : null,
    focusTracks: parseJson<Track[]>(row.focus_tracks_json, []),
    subtracks: parseJson<string[]>(row.subtracks_json, []),
    stageFocus: parseJson<string[]>(row.stage_focus_json, []),
    investmentStyle: row.investment_style ? String(row.investment_style) : null,
    thesis: row.thesis ? String(row.thesis) : null,
    keyPeople: parseJson<InvestorSummary["keyPeople"]>(row.key_people_json, []),
    portfolioSample: parseJson<InvestorSummary["portfolioSample"]>(row.portfolio_sample_json, []),
    fundSize: row.fund_size_json ? parseJson<InvestorSummary["fundSize"]>(row.fund_size_json, null) : null,
    sourceRefs: parseJson<string[]>(row.source_refs_json, []),
    status: String(row.status ?? "seed_candidate") as InvestorStatus,
    priority: (Number(row.priority ?? 2) as InvestorPriority) || 2,
    rank: row.rank === null || row.rank === undefined ? null : Number(row.rank),
    verification: row.verification_json ? parseJson<InvestorSummary["verification"]>(row.verification_json, null) : null,
    notes: row.notes ? String(row.notes) : "",
    portfolioCount,
    trackPerformance: parseJson<InvestorSummary["trackPerformance"]>(row.track_performance_json, {}),
    version: Number(row.version ?? 1),
    createdAt: String(row.created_at),
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  };
}

export class SqliteInvestorDirectoryRepository {
  constructor(private readonly database: DatabaseSync) {}

  list(filters: InvestorDirectoryFilters = {}): { items: InvestorSummary[]; total: number; page: number; perPage: number } {
    const rows = this.database.prepare("SELECT * FROM investors ORDER BY priority ASC, CASE WHEN rank IS NULL THEN 1 ELSE 0 END, rank ASC, name ASC").all() as unknown as Row[];
    const query = (filters.query ?? "").trim().toLocaleLowerCase("zh-CN");
    const matched = rows.filter((row) => matchesFilters(row, filters, query));
    const perPage = Math.min(Math.max(filters.perPage ?? DEFAULT_PER_PAGE, 1), MAX_PER_PAGE);
    const page = Math.max(filters.page ?? 1, 1);
    const start = (page - 1) * perPage;
    const items = matched.slice(start, start + perPage).map((row) => mapInvestorRow(row, this.portfolioCount(row)));
    return { items, total: matched.length, page, perPage };
  }

  findById(id: string): InvestorDetail | undefined {
    const row = this.database.prepare("SELECT * FROM investors WHERE id = ?").get(id) as unknown as Row | undefined;
    if (!row) return undefined;
    const history = this.investmentHistory(row);
    return { ...mapInvestorRow(row, history.length), investmentHistory: history, extra: parseJson<Record<string, string>>(row.extra_json, {}) };
  }

  findByName(name: string): InvestorSummary | undefined {
    const row = this.database.prepare("SELECT * FROM investors WHERE name = ?").get(name) as unknown as Row | undefined;
    return row ? mapInvestorRow(row, this.portfolioCount(row)) : undefined;
  }

  create(input: InvestorWriteInput, actorId: string, id = `inv-${randomUUID()}`): InvestorDetail {
    const now = new Date().toISOString();
    if (this.findByName(input.name)) throw new Error("机构名称已存在。");
    this.database.prepare(`INSERT INTO investors
      (id,name,aliases_json,type,headquarters,focus_tracks_json,stage_focus_json,track_performance_json,created_at,
       english_name,institution_type,subtracks_json,check_size_json,investment_style,thesis,key_people_json,portfolio_sample_json,
       fund_size_json,source_refs_json,status,priority,rank,verification_json,notes,extra_json,version,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`).run(
      id, input.name, JSON.stringify(input.aliases ?? []), legacyInvestorType(input.institutionType), input.headquarters ?? null,
      JSON.stringify(input.focusTracks), JSON.stringify(input.stageFocus ?? []), JSON.stringify(input.trackPerformance ?? {}), now,
      input.englishName ?? null, input.institutionType, JSON.stringify(input.subtracks ?? []), input.investmentStyle ?? null, input.thesis ?? null,
      JSON.stringify(input.keyPeople ?? []), JSON.stringify(input.portfolioSample ?? []), input.fundSize ? JSON.stringify(input.fundSize) : null,
      JSON.stringify(input.sourceRefs ?? []), input.status ?? "seed_candidate", input.priority ?? 2, input.rank ?? null,
      input.verification ? JSON.stringify(input.verification) : null, input.notes ?? "", JSON.stringify(input.extra ?? {}), now,
    );
    this.audit(actorId, "investor.create", id, null, input, now);
    return this.findById(id)!;
  }

  update(id: string, patch: Partial<InvestorWriteInput>, expectedVersion: number, actorId: string): InvestorDetail {
    const current = this.findById(id);
    if (!current) throw new Error("机构不存在。");
    if (current.version !== expectedVersion) throw new Error("版本冲突：机构信息已发生变化。");
    if (patch.name && patch.name !== current.name && this.findByName(patch.name)) throw new Error("机构名称已存在。");
    const next: Required<InvestorWriteInput> = {
      name: patch.name ?? current.name,
      englishName: patch.englishName === undefined ? current.englishName : patch.englishName,
      aliases: patch.aliases ?? current.aliases,
      institutionType: patch.institutionType ?? current.institutionType,
      headquarters: patch.headquarters === undefined ? current.headquarters : patch.headquarters,
      focusTracks: patch.focusTracks ?? current.focusTracks,
      subtracks: patch.subtracks ?? current.subtracks,
      stageFocus: patch.stageFocus ?? current.stageFocus,
      investmentStyle: patch.investmentStyle === undefined ? current.investmentStyle : patch.investmentStyle,
      thesis: patch.thesis === undefined ? current.thesis : patch.thesis,
      keyPeople: patch.keyPeople ?? current.keyPeople,
      portfolioSample: patch.portfolioSample ?? current.portfolioSample,
      fundSize: patch.fundSize === undefined ? current.fundSize : patch.fundSize,
      sourceRefs: patch.sourceRefs ?? current.sourceRefs,
      status: patch.status ?? current.status,
      priority: patch.priority ?? current.priority,
      rank: patch.rank === undefined ? current.rank : patch.rank,
      verification: patch.verification === undefined ? current.verification : patch.verification,
      notes: patch.notes ?? current.notes,
      trackPerformance: patch.trackPerformance ?? current.trackPerformance,
      extra: patch.extra ?? current.extra,
    };
    const now = new Date().toISOString();
    const result = this.database.prepare(`UPDATE investors SET
      name=?,aliases_json=?,type=?,headquarters=?,focus_tracks_json=?,stage_focus_json=?,track_performance_json=?,
      english_name=?,institution_type=?,subtracks_json=?,investment_style=?,thesis=?,key_people_json=?,portfolio_sample_json=?,
      fund_size_json=?,source_refs_json=?,status=?,priority=?,rank=?,verification_json=?,notes=?,extra_json=?,version=version+1,updated_at=?
      WHERE id=? AND version=?`).run(
      next.name, JSON.stringify(next.aliases), legacyInvestorType(next.institutionType), next.headquarters ?? null,
      JSON.stringify(next.focusTracks), JSON.stringify(next.stageFocus), JSON.stringify(next.trackPerformance),
      next.englishName ?? null, next.institutionType, JSON.stringify(next.subtracks), next.investmentStyle ?? null, next.thesis ?? null,
      JSON.stringify(next.keyPeople), JSON.stringify(next.portfolioSample), next.fundSize ? JSON.stringify(next.fundSize) : null,
      JSON.stringify(next.sourceRefs), next.status, next.priority, next.rank ?? null,
      next.verification ? JSON.stringify(next.verification) : null, next.notes, JSON.stringify(next.extra), now, id, expectedVersion,
    );
    if (Number(result.changes) !== 1) throw new Error("版本冲突：机构信息已发生变化。");
    this.audit(actorId, "investor.update", id, current, patch, now);
    return this.findById(id)!;
  }

  /**
   * 批量导入：按 id（若提供）或名称合并；已存在的机构只补空字段，不覆盖人工维护过的值。
   * 返回导入统计，便于脚本 dry-run 输出。
   */
  upsertMany(entries: Array<InvestorWriteInput & { id?: string }>, actorId: string): { inserted: number; updated: number; skipped: number } {
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const entry of entries) {
        const existing = (entry.id ? this.findById(entry.id) : undefined) ?? (this.findByName(entry.name) ? this.findById(this.findByName(entry.name)!.id) : undefined);
        if (!existing) {
          this.create(entry, actorId, entry.id ?? `inv-${randomUUID()}`);
          inserted += 1;
          continue;
        }
        const patch = fillOnlyEmpty(existing, entry);
        if (Object.keys(patch).length === 0) { skipped += 1; continue; }
        this.update(existing.id, patch, existing.version, actorId);
        updated += 1;
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { inserted, updated, skipped };
  }

  private investmentHistory(row: Row): InvestmentEventSummary[] {
    const keys = [String(row.id), String(row.name), ...parseJson<string[]>(row.aliases_json, [])].filter((key) => key.trim().length > 0);
    const rows = this.database.prepare(`SELECT ie.*, c.legal_name AS company_name, c.id AS company_id,
        (SELECT p.track FROM projects p WHERE p.company_id = c.id LIMIT 1) AS track
      FROM investment_events ie JOIN companies c ON c.id = ie.company_id
      ORDER BY ie.announced_at DESC`).all() as unknown as Row[];
    return rows
      .map((event) => ({ event, investors: parseJson<string[]>(event.investors_json, []), leadInvestors: parseJson<string[]>(event.lead_investors_json, []) }))
      .filter(({ investors }) => investors.some((investor) => keys.includes(investor)))
      .map(({ event, investors, leadInvestors }) => ({
        id: String(event.id),
        companyId: String(event.company_id),
        companyName: String(event.company_name),
        track: (event.track ? String(event.track) : "AI") as Track,
        round: String(event.round) as InvestmentEventSummary["round"],
        announcedAt: String(event.announced_at),
        amount: event.amount === null ? null : Number(event.amount),
        currency: event.currency ? (String(event.currency) as "CNY" | "USD") : null,
        disclosureType: String(event.disclosure_type) as InvestmentEventSummary["disclosureType"],
        investors,
        leadInvestors,
        confidence: Number(event.confidence),
      }));
  }

  private portfolioCount(row: Row): number {
    return this.investmentHistory(row).length;
  }

  private audit(actorId: string, action: string, resourceId: string, before: unknown, after: unknown, now: string): void {
    this.database.prepare(`INSERT OR IGNORE INTO audit_log (id,actor,action,resource_type,resource_id,before_json,after_json,note,request_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), actorId, action, "investor", resourceId, JSON.stringify(before ?? null), JSON.stringify(after ?? null), "", randomUUID(), now);
  }
}

function matchesFilters(row: Row, filters: InvestorDirectoryFilters, query: string): boolean {
  if (filters.status && filters.status !== "all" && row.status !== filters.status) return false;
  if (filters.institutionType && filters.institutionType !== "all" && row.institution_type !== filters.institutionType) return false;
  if (filters.priority && filters.priority !== "all" && Number(row.priority) !== filters.priority) return false;
  if (filters.track && filters.track !== "all" && !parseJson<string[]>(row.focus_tracks_json, []).includes(filters.track)) return false;
  if (!query) return true;
  const haystack = [row.name, row.english_name, row.headquarters, row.investment_style, ...parseJson<string[]>(row.aliases_json, [])]
    .filter((value): value is string | number => value !== null && value !== undefined)
    .map((value) => String(value).toLocaleLowerCase("zh-CN"));
  return haystack.some((value) => value.includes(query));
}

function fillOnlyEmpty(existing: InvestorDetail, entry: InvestorWriteInput): Partial<InvestorWriteInput> {
  const patch: Partial<InvestorWriteInput> = {};
  if (!existing.englishName && entry.englishName) patch.englishName = entry.englishName;
  if (existing.aliases.length === 0 && entry.aliases?.length) patch.aliases = entry.aliases;
  if (!existing.headquarters && entry.headquarters) patch.headquarters = entry.headquarters;
  if (existing.focusTracks.length === 0 && entry.focusTracks.length > 0) patch.focusTracks = entry.focusTracks;
  if (existing.subtracks.length === 0 && entry.subtracks?.length) patch.subtracks = entry.subtracks;
  if (existing.stageFocus.length === 0 && entry.stageFocus?.length) patch.stageFocus = entry.stageFocus;
  if (!existing.investmentStyle && entry.investmentStyle) patch.investmentStyle = entry.investmentStyle;
  if (!existing.thesis && entry.thesis) patch.thesis = entry.thesis;
  if (existing.keyPeople.length === 0 && entry.keyPeople?.length) patch.keyPeople = entry.keyPeople;
  if (existing.portfolioSample.length === 0 && entry.portfolioSample?.length) patch.portfolioSample = entry.portfolioSample;
  if (!existing.fundSize && entry.fundSize) patch.fundSize = entry.fundSize;
  if (existing.sourceRefs.length === 0 && entry.sourceRefs?.length) patch.sourceRefs = entry.sourceRefs;
  if (existing.rank === null && entry.rank !== undefined && entry.rank !== null) patch.rank = entry.rank;
  if (!existing.notes && entry.notes) patch.notes = entry.notes;
  const mergedExtra = { ...(entry.extra ?? {}), ...existing.extra };
  if (Object.keys(mergedExtra).length !== Object.keys(existing.extra).length) patch.extra = mergedExtra;
  return patch;
}

function parseJson<T>(value: string | number | null | undefined, fallback: T): T {
  if (value === null || value === undefined || value === "") return fallback;
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
}
