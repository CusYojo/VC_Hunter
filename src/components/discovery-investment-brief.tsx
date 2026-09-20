import type { IntelligenceCandidateView } from "@/intelligence/repository";
import type { CandidateView } from "@/workbench/candidate-details";

export interface InvestmentBriefFact { label: string; value: string; wide?: boolean }
export interface InvestmentBriefView { summary: string; facts: InvestmentBriefFact[] }

export function buildIntelligenceInvestmentBrief(candidate: IntelligenceCandidateView): InvestmentBriefView {
  const company = record(candidate.details.company);
  const person = record(candidate.details.person);
  const technology = record(candidate.details.technology);
  const latestFunding = latestFundingEvent(company.fundingHistory);
  const companyFacts = candidate.entityType === "company" ? [
    fact("行业分类", joinNonEmpty([candidate.track, candidate.subtrack], " / ") || "待补充"),
    fact("最新融资日期", text(latestFunding.announcedAt) || (candidate.signalType === "funding" ? candidate.eventDate : "未披露")),
    fact("融资金额", fundingAmount(latestFunding)),
    fact("融资轮次", fundingRound(latestFunding)),
    fact("投资方", investorSummary(latestFunding, candidate.relationships), true),
    fact("核心团队背景", assertionSummary(candidate.assertions, "coreTeam") || relationshipSummary(candidate.relationships) || "待补充", true),
  ] : [];
  const personFacts = candidate.entityType === "person" ? compactFacts([
    fact("当前机构", joinNonEmpty([text(person.organization), text(person.title)], " · ")),
    fact("教育背景", first(strings(person.education))),
    fact("技术背景", text(person.technicalBackground)),
    fact("相关赛道", candidate.subtrack || candidate.track),
  ]) : [];
  const technologyFacts = candidate.entityType === "technology" ? compactFacts([
    fact("技术定义", text(technology.definition)),
    fact("关键指标", strings(technology.keyMetrics).slice(0, 2).join("、")),
    fact("成熟度", text(technology.maturity)),
    fact("相关赛道", candidate.subtrack || candidate.track),
  ]) : [];
  return {
    summary: oneSentence(candidate.investmentSummary || candidate.discoveryReason),
    facts: companyFacts.length ? companyFacts : personFacts.length ? personFacts : technologyFacts,
  };
}

export function buildLegacyInvestmentBrief(candidate: CandidateView): InvestmentBriefView {
  return {
    summary: oneSentence(candidate.summary),
    facts: [
      fact("行业分类", candidate.rawTrack || candidate.track || "待补充"),
      fact("最新融资日期", candidate.eventDate || dateOnly(candidate.lead.publishedAt) || dateOnly(candidate.createdAt) || "未披露"),
      fact("融资金额", candidate.amountText || "未披露"),
      fact("融资轮次", candidate.round || "未披露"),
      fact("投资方", candidate.investorNames.slice(0, 4).join("、") || "未披露", true),
      fact("核心团队背景", "待补充", true),
    ],
  };
}

export function DiscoveryInvestmentBrief({ name, brief }: { name: string; brief: InvestmentBriefView }) {
  return <section aria-label={`${name}投资速览`} className="mt-3 rounded-lg border border-primary/15 bg-primary/[0.035] p-3.5">
    <p className="text-xs font-semibold tracking-wide text-primary">项目摘要</p>
    <p className="mt-1.5 line-clamp-2 text-sm leading-6 text-foreground">{brief.summary || "项目一句话简介待补充。"}</p>
    {brief.facts.length > 0 && <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-primary/10 pt-3">
      {brief.facts.map((item) => <div key={`${item.label}:${item.value}`} className={`min-w-0 ${item.wide ? "col-span-2" : ""}`}><dt className="text-[11px] font-medium text-muted-foreground">{item.label}</dt><dd className={`mt-0.5 break-words text-xs font-medium leading-5 text-foreground ${item.wide ? "line-clamp-3" : "line-clamp-2"}`}>{item.value}</dd></div>)}
    </dl>}
  </section>;
}

function oneSentence(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  const sentences = normalized.match(/[^。！？!?]+[。！？!?]?/gu) ?? [];
  const selected = (sentences[0] ?? normalized).trim();
  return selected.length > 120 ? `${selected.slice(0, 119).trimEnd()}…` : selected;
}

function relationshipSummary(value: IntelligenceCandidateView["relationships"]): string {
  return (value ?? []).flatMap((item) => {
    const row = record(item);
    const name = text(row.name), relation = text(row.relation);
    return row.entityType === "person" && name ? [`${name}${relation ? `（${relation}）` : ""}`] : [];
  }).slice(0, 2).join("、");
}

function investorSummary(latest: Record<string, unknown>, relationships: IntelligenceCandidateView["relationships"]): string {
  const disclosed = strings(latest.investors);
  if (disclosed.length) return summarizedList(disclosed, 4);
  const related = (relationships ?? []).flatMap((item) => {
    const row = record(item), relation = text(row.relation).toLocaleLowerCase("zh-CN");
    return relation.includes("投资") && text(row.name) ? [text(row.name)] : [];
  });
  return summarizedList(related, 4) || "未披露";
}

function compactFacts(values: Array<InvestmentBriefFact | null>): InvestmentBriefFact[] {
  return values.filter((value): value is InvestmentBriefFact => Boolean(value?.value)).slice(0, 4);
}
function fact(label: string, value: string | null | undefined, wide = false): InvestmentBriefFact { return { label, value: value?.trim() || "待补充", ...(wide ? { wide: true } : {}) }; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : []; }
function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function first(values: string[]): string { return values[0] ?? ""; }
function joinNonEmpty(values: Array<string | null | undefined>, separator: string): string { return values.filter((value): value is string => Boolean(value?.trim())).join(separator); }
function latestFundingEvent(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value)) return {};
  return value.map(record).sort((left, right) => text(right.announcedAt).localeCompare(text(left.announcedAt)))[0] ?? {};
}
function fundingRound(value: Record<string, unknown>): string {
  const labels: Record<string, string> = { angel: "天使轮", pre_a: "Pre-A轮", a: "A轮", b: "B轮", c: "C轮", d_plus: "D轮及以后", strategic: "战略融资", other: "新一轮融资" };
  return labels[text(value.round)] ?? (text(value.round) || "未披露");
}
function fundingAmount(value: Record<string, unknown>): string {
  if (typeof value.amount !== "number") return "未披露";
  const currency = text(value.currency);
  const suffix = currency === "USD" ? "美元" : currency === "CNY" ? "元人民币" : currency;
  const amount = value.amount >= 100_000_000
    ? `${Number((value.amount / 100_000_000).toFixed(2))}亿`
    : value.amount >= 10_000
      ? `${Number((value.amount / 10_000).toFixed(2))}万`
      : value.amount.toLocaleString("zh-CN");
  const approximate = ["range", "estimated"].includes(text(value.disclosureType)) ? "约" : "";
  return `${approximate}${amount}${suffix}`;
}
function assertionSummary(value: IntelligenceCandidateView["assertions"], field: string): string {
  const assertion = (value ?? []).map(record).find((item) => text(item.field) === field && !["unknown", "not_disclosed"].includes(text(item.valueStatus)));
  if (!assertion) return "";
  if (typeof assertion.value === "string") return assertion.value.trim();
  if (Array.isArray(assertion.value)) return strings(assertion.value).join("；");
  return "";
}
function summarizedList(values: string[], limit: number): string {
  const unique = [...new Set(values.filter(Boolean))];
  return `${unique.slice(0, limit).join("、")}${unique.length > limit ? "等" : ""}`;
}
function dateOnly(value: string | null | undefined): string { return typeof value === "string" ? value.slice(0, 10) : ""; }
