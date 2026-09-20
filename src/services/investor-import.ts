import type { InvestorWriteInput } from "../repositories/investor-directory";
import { INSTITUTION_TYPE_VALUES, INVESTOR_STATUS_VALUES, type InstitutionType, type Track } from "../domain/types";
import { investorInputSchema } from "../workbench/contracts";

export type InvestorImportRow = Record<string, unknown>;
export interface InvestorImportOptions {
  sourceFile?: string;
  sourceSheet?: string;
  sourceSha256?: string;
  expectedCount?: number;
}

const HEADER_GROUPS: Record<string, string[]> = {
  name: ["机构名", "机构名称", "名称", "机构"], englishName: ["英文名", "英文名称"], aliases: ["别名", "曾用名"],
  institutionType: ["机构类型", "类型"], headquarters: ["主要地区", "总部", "所在地", "总部所在地"],
  focusTracks: ["核心赛道", "关注赛道", "赛道", "覆盖赛道"], subtracks: ["细分方向", "细分赛道"],
  stageFocus: ["投资阶段", "阶段"], investmentStyle: ["投资风格"], thesis: ["投资逻辑", "投资主题"],
  keyPeople: ["关键人物", "核心人物"], portfolioSample: ["明星/代表项目", "代表案例", "代表被投", "代表项目"],
  fundSize: ["公开管理规模/体系规模", "基金规模"], sourceRefs: ["来源URL", "来源", "信息来源"],
  status: ["核验状态", "状态"], priority: ["活跃优先级", "优先级"], rank: ["排名", "序号"], notes: ["备注"],
  verification: [], extra: [], trackPerformance: [],
};
const headerKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "");
const HEADERS = new Map(Object.entries(HEADER_GROUPS).flatMap(([field, aliases]) => [field, ...aliases].map((alias) => [headerKey(alias), field])));
const text = (value: unknown): string => value == null ? "" : typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
const list = (value: unknown): string[] => Array.isArray(value) ? value.map(text) : text(value).split(/[、，,;；/|\n]+/).map((part) => part.trim()).filter(Boolean);

function fieldsFor(raw: InvestorImportRow): InvestorImportRow {
  const result: InvestorImportRow = {};
  for (const [header, value] of Object.entries(raw)) {
    const key = HEADERS.get(headerKey(header)) ?? header.trim();
    if (Object.hasOwn(result, key) && text(result[key]) !== text(value)) throw new Error(`表头映射冲突：${header}`);
    result[key] = value;
  }
  return result;
}

function institutionType(value: unknown): InstitutionType {
  const raw = text(value).trim();
  if ((INSTITUTION_TYPE_VALUES as readonly string[]).includes(raw)) return raw as InstitutionType;
  const mappings: [RegExp, InstitutionType][] = [
    [/国家|大基金|国家队|国字号/, "national_fund"],
    [/地方|政府|国资|引导|[省市区]级|市属|省属|园区|区域/, "local_government"],
    [/cvc|央企|战投|战略投资|企业风投/i, "cvc"],
    [/孵化|加速器|创新中心/, "incubator"],
    // Mixed VC/PE retains the VC directory category; the precise source type remains in extra.
    [/vc|风投|创投|财务|市场化(?!pe)|早期|高校|产业背景/i, "financial_vc"],
    [/pe|私募股权|并购基金/i, "pe"],
    [/产业/, "cvc"],
  ];
  return mappings.find(([pattern]) => pattern.test(raw))?.[1] ?? "other";
}

const TRACK_PATTERNS: [RegExp, Track][] = [
  [/人工智能|大模型|\bai\b|机器学习/i, "AI"], [/具身|机器人|人形/, "具身智能"],
  [/半导体|芯片|集成电路|晶圆|光刻/, "半导体"], [/聚变/, "核聚变"],
  [/生物|医药|创新药|医疗|基因/, "生物医药"], [/航天|火箭|卫星|太空/, "商业航天"], [/材料/, "新材料"],
];
function tracks(value: unknown): Track[] {
  return [...new Set(list(value).flatMap((part) => TRACK_PATTERNS.filter(([pattern]) => pattern.test(part)).map(([, track]) => track)))];
}

function status(value: unknown): NonNullable<InvestorWriteInput["status"]> {
  const raw = text(value).trim();
  if ((INVESTOR_STATUS_VALUES as readonly string[]).includes(raw)) return raw as NonNullable<InvestorWriteInput["status"]>;
  if (/未核|待核|未经|unverified/i.test(raw)) return "seed_candidate";
  if (/已核验|已核实/.test(raw)) return "verified";
  if (/活跃|监控中/.test(raw)) return "active";
  if (/暂停/.test(raw)) return "paused";
  if (/合并/.test(raw)) return "merged";
  return "seed_candidate";
}

function priority(value: unknown): 1 | 2 | 3 {
  const raw = text(value).trim();
  if (/^(s|1)$/i.test(raw) || /头部|必看|一线|top/i.test(raw)) return 1;
  if (/^(b|c|3)$/i.test(raw) || /观察|长尾|watch/i.test(raw)) return 3;
  return 2;
}

/** Never split a URL on slash, comma or semicolon: these are legal URI characters. */
function sources(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(text);
  return text(value).split(/\r?\n|[；、，]\s*(?=https?:\/\/)|\s+(?=https?:\/\/)/i).map((part) => part.trim()).filter(Boolean);
}

function rawExtra(raw: InvestorImportRow, options: InvestorImportOptions): Record<string, string> {
  const extra = Object.fromEntries(Object.entries(raw).filter(([key]) => headerKey(key) !== "extra").map(([key, value]) => [`原始列:${key}`, text(value)]));
  return { ...(raw.extra && typeof raw.extra === "object" && !Array.isArray(raw.extra) ? raw.extra as Record<string, string> : {}), ...extra,
    ...(options.sourceFile ? { sourceFile: options.sourceFile } : {}), ...(options.sourceSheet ? { sourceSheet: options.sourceSheet } : {}),
    ...(options.sourceSha256 ? { sourceSha256: options.sourceSha256 } : {}),
  };
}

export function normalizeInvestorRow(raw: InvestorImportRow, options: InvestorImportOptions = {}): InvestorWriteInput {
  const fields = fieldsFor(raw);
  if (!text(fields.name).trim()) throw new Error("缺少机构名称；整批导入已停止。");
  const sourceRefs = sources(fields.sourceRefs);
  const mappedStatus = status(fields.status);
  const fundText = text(fields.fundSize).trim();
  const result = {
    name: text(fields.name), englishName: text(fields.englishName) || null, aliases: list(fields.aliases),
    institutionType: institutionType(fields.institutionType), headquarters: text(fields.headquarters) || null,
    focusTracks: tracks(fields.focusTracks), subtracks: list(fields.subtracks), stageFocus: list(fields.stageFocus),
    investmentStyle: text(fields.investmentStyle) || null, thesis: text(fields.thesis) || null,
    keyPeople: Array.isArray(fields.keyPeople) ? fields.keyPeople : list(fields.keyPeople).map((name) => ({ name, title: null })),
    portfolioSample: Array.isArray(fields.portfolioSample) ? fields.portfolioSample : list(fields.portfolioSample).map((company) => ({ company, track: null })),
    fundSize: fields.fundSize && typeof fields.fundSize === "object" ? fields.fundSize : fundText ? { amount: null, currency: null, text: fundText } : null,
    sourceRefs, status: mappedStatus, priority: priority(fields.priority), rank: text(fields.rank).trim() ? Number(fields.rank) : null,
    verification: fields.verification ?? (mappedStatus === "verified" ? { verifiedAt: null, verifiedBy: null, notes: `源表核验状态：${text(fields.status)}；仅沿用源表标记，未执行独立核验。` } : null),
    notes: text(fields.notes), extra: rawExtra(raw, options),
    ...(fields.trackPerformance ? { trackPerformance: fields.trackPerformance } : {}),
  };
  return investorInputSchema.parse(result);
}

export function prepareInvestorImport(rows: InvestorImportRow[], options: InvestorImportOptions = {}) {
  if (options.expectedCount !== undefined && rows.length !== options.expectedCount) throw new Error(`预期 ${options.expectedCount} 家机构，实际 ${rows.length} 行。`);
  if (!rows.length) throw new Error("没有可导入机构。");
  const entries = rows.map((row, index) => {
    try { return normalizeInvestorRow(row, options); } catch (error) { throw new Error(`第 ${index + 2} 行：${error instanceof Error ? error.message : String(error)}`); }
  });
  const names = entries.map((entry) => entry.name.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/\s+/g, ""));
  if (new Set(names).size !== entries.length) throw new Error("发现重复机构名称；整批导入已停止，请先人工合并。");
  const warnings = rows.flatMap((row, index) => {
    const raw = fieldsFor(row);
    const unmapped = list(raw.focusTracks).filter((part) => !tracks(part).length);
    return unmapped.length ? [`${entries[index].name}：未映射赛道 ${unmapped.join("、")}，原文已保留。`] : [];
  });
  return { entries, warnings, summary: { rows: rows.length, uniqueInstitutions: names.length,
    verified: entries.filter((entry) => entry.status === "verified").length, noTrack: entries.filter((entry) => !entry.focusTracks.length).length,
    priority1: entries.filter((entry) => entry.priority === 1).length, priority2: entries.filter((entry) => entry.priority === 2).length,
    priority3: entries.filter((entry) => entry.priority === 3).length,
  } };
}

export function parseInvestorJson(input: string): InvestorImportRow[] {
  const parsed: unknown = JSON.parse(input);
  const rows = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && "items" in parsed ? parsed.items : undefined;
  if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("JSON 必须为机构对象数组或 {items: [...]}。");
  return rows;
}

/** RFC-style quoted CSV; reject damaged rows instead of losing cells. */
export function parseInvestorCsv(input: string): InvestorImportRow[] {
  const rows: string[][] = [];
  let field = "", record: string[] = [], quoted = false, closed = false;
  const clean = input.replace(/^\ufeff/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if (quoted) {
      if (char !== '"') field += char;
      else if (clean[index + 1] === '"') { field += '"'; index += 1; }
      else { quoted = false; closed = true; }
    } else if (char === "," || char === "\n") {
      record.push(field); field = ""; closed = false;
      if (char === "\n") { rows.push(record); record = []; }
    } else if (char === '"' && !field && !closed) quoted = true;
    else if (closed || char === '"') throw new Error("CSV 引号格式错误。");
    else field += char;
  }
  if (quoted) throw new Error("CSV 引号未闭合。");
  if (field || record.length || closed) rows.push([...record, field]);
  const nonEmpty = rows.filter((row) => row.some((cell) => cell.trim()));
  if (!nonEmpty.length) return [];
  const headers = nonEmpty[0].map((header) => header.trim());
  if (headers.some((header) => !header) || new Set(headers.map(headerKey)).size !== headers.length) throw new Error("CSV 表头为空或重复。");
  return nonEmpty.slice(1).map((row) => {
    if (row.length !== headers.length) throw new Error("CSV 数据列数与表头不一致。");
    return Object.fromEntries(headers.map((header, index) => [header, row[index]]));
  });
}
