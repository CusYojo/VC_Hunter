import { z } from "zod";
import ipaddr from "ipaddr.js";

export const TRACKS = ["AI", "具身智能", "半导体", "核聚变", "生物医药", "商业航天", "新材料"] as const;
export const PRIORITY_BANDS = ["A", "B", "C"] as const;
export const COMPLETENESS_LEVELS = ["L0", "L1", "L2"] as const;
export const ENTITY_TYPES = ["company", "person", "technology"] as const;
export const DISCOVERY_CHANNELS = ["venture_tech", "registry", "hiring", "ranking_award", "manual_codex"] as const;
export const PRIORITY_CITIES = ["北京", "上海", "深圳", "杭州", "苏州", "广州", "合肥", "武汉", "成都", "西安", "南京", "无锡"] as const;

export type Track = typeof TRACKS[number];
export type PriorityBand = typeof PRIORITY_BANDS[number];
export type CompletenessLevel = typeof COMPLETENESS_LEVELS[number];
export type EntityType = typeof ENTITY_TYPES[number];
export type DiscoveryChannel = typeof DISCOVERY_CHANNELS[number];
export type CandidateScores = { technology: number; team: number; commercial: number; signal: number; evidence: number };

const httpsUrl = z.string().trim().min(1).max(4_000).superRefine((value, context) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || isUnsafeHostname(url.hostname)) {
      context.addIssue({ code: "custom", message: "URL 必须是无凭据的公开 HTTPS 地址。" });
    }
  } catch {
    context.addIssue({ code: "custom", message: "URL 格式无效。" });
  }
});

const scoreSchema = z.number().int().min(0).max(5);
export const candidateScoresSchema = z.object({
  technology: scoreSchema,
  team: scoreSchema,
  commercial: scoreSchema,
  signal: scoreSchema,
  evidence: scoreSchema,
}).strict();

export const candidateEvidenceSchema = z.object({
  ref: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(500),
  url: httpsUrl,
  publishedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  observedAt: z.iso.datetime({ offset: true }),
  excerpt: z.string().trim().min(1).max(8_000),
  authority: z.enum(["A", "B", "C", "D"]),
  accessClass: z.enum(["public", "licensed_internal", "user_supplied"]),
  collectionMethod: z.enum(["web_search", "rss", "api", "codex", "manual_upload"]),
  allowExternalModel: z.boolean(),
}).strict().superRefine((evidence, context) => {
  if (evidence.accessClass !== "public" && evidence.allowExternalModel) context.addIssue({ code: "custom", message: "受限或用户提供资料不能外发给外部模型。", path: ["allowExternalModel"] });
});

export const candidateAssertionSchema = z.object({
  field: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(200),
  valueStatus: z.enum(["known", "unknown", "not_disclosed", "estimated"]),
  epistemicType: z.enum(["fact", "inference", "opinion"]),
  value: z.unknown().optional(),
  unit: z.string().trim().max(80).optional(),
  confidence: z.number().min(0).max(1),
  evidenceRefs: z.array(z.string().trim().min(1).max(120)).max(20),
}).strict().superRefine((assertion, context) => {
  if (assertion.valueStatus === "known" && assertion.value === undefined) context.addIssue({ code: "custom", message: "已知字段必须提供值。", path: ["value"] });
  if (assertion.valueStatus === "estimated" && assertion.epistemicType === "fact") context.addIssue({ code: "custom", message: "估算值不能标记为事实。", path: ["epistemicType"] });
  if (assertion.epistemicType === "fact" && assertion.valueStatus !== "unknown" && assertion.evidenceRefs.length === 0) context.addIssue({ code: "custom", message: "事实字段必须关联来源。", path: ["evidenceRefs"] });
});

const relationshipSchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  entityId: z.string().trim().max(200).optional(),
  name: z.string().trim().min(1).max(300),
  relation: z.string().trim().min(1).max(120),
  confidence: z.number().min(0).max(1),
  evidenceRefs: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
}).strict();

const contactEvidenceFields = {
  sourceRef: z.string().trim().min(1).max(120),
  verifiedAt: z.iso.datetime({ offset: true }),
};
const publicWorkEmail = z.email().max(320).superRefine((value, context) => {
  const domain = value.split("@").at(-1)?.toLocaleLowerCase("en-US");
  if (domain && ["gmail.com", "hotmail.com", "outlook.com", "icloud.com", "qq.com", "163.com", "126.com"].includes(domain)) context.addIssue({ code: "custom", message: "首期不保存常见私人邮箱域名。" });
});
const publicWorkPhone = z.string().trim().regex(/^\+?[0-9() -]{6,30}$/u).superRefine((value, context) => {
  const digits = value.replace(/\D/gu, "").replace(/^86(?=1[3-9]\d{9}$)/u, "");
  if (/^1[3-9]\d{9}$/u.test(digits)) context.addIssue({ code: "custom", message: "首期不保存疑似个人手机号。" });
});
const publicContactSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("work_email"), value: publicWorkEmail, ...contactEvidenceFields }).strict(),
  z.object({ type: z.literal("work_phone"), value: publicWorkPhone, ...contactEvidenceFields }).strict(),
  z.object({ type: z.literal("website_contact"), value: httpsUrl, ...contactEvidenceFields }).strict(),
  z.object({ type: z.literal("public_profile"), value: httpsUrl, ...contactEvidenceFields }).strict(),
]);

const fundingEventSchema = z.object({
  round: z.enum(["angel", "pre_a", "a", "b", "c", "d_plus", "strategic", "other"]),
  announcedAt: z.iso.date(),
  amount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  currency: z.enum(["CNY", "USD"]).optional(),
  disclosureType: z.enum(["exact", "range", "undisclosed", "estimated"]),
  valuation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  investors: z.array(z.string().trim().min(1).max(300)).max(100).default([]),
  leadInvestors: z.array(z.string().trim().min(1).max(300)).max(100).default([]),
  sourceRefs: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
}).strict().superRefine((event, context) => {
  if ((event.amount !== undefined || event.valuation !== undefined) && !event.currency) context.addIssue({ code: "custom", message: "披露金额或估值时必须提供币种。", path: ["currency"] });
});

const maEventSchema = z.object({
  acquirerName: z.string().trim().min(1).max(300),
  announcementDate: z.iso.date(),
  transactionType: z.enum(["acquisition", "merger", "asset_purchase", "strategic_investment"]),
  transactionValue: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  currency: z.enum(["CNY", "USD"]).optional(),
  transactionStage: z.enum(["proposed", "approved", "closed", "terminated"]),
  strategicRationale: z.string().trim().max(2_000).optional(),
  sourceRefs: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
}).strict().superRefine((event, context) => {
  if (event.transactionValue !== undefined && !event.currency) context.addIssue({ code: "custom", message: "披露交易金额时必须提供币种。", path: ["currency"] });
});

const companyDetailsSchema = z.object({
  legalName: z.string().trim().min(1).max(300).optional(),
  unifiedCreditCode: z.string().trim().min(8).max(40).optional(),
  incorporationDate: z.iso.date().optional(),
  officialWebsite: httpsUrl.optional(),
  registeredAddress: z.string().trim().max(1_000).optional(),
  researchLocations: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  businessScope: z.string().trim().max(4_000).optional(),
  products: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  coreTechnologies: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
  competitors: z.array(z.string().trim().min(1).max(300)).max(100).default([]),
  fundingHistory: z.array(fundingEventSchema).max(100).default([]),
  mergersAndAcquisitions: z.array(maEventSchema).max(100).default([]),
}).strict();

const personDetailsSchema = z.object({
  organization: z.string().trim().max(300).optional(),
  title: z.string().trim().max(200).optional(),
  education: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
  employment: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
  technicalBackground: z.string().trim().max(8_000).optional(),
  publications: z.array(z.string().trim().min(1).max(1_000)).max(300).default([]),
  patents: z.array(z.string().trim().min(1).max(1_000)).max(300).default([]),
  homepage: httpsUrl.optional(),
  reports: z.array(httpsUrl).max(100).default([]),
}).strict();

const technologyDetailsSchema = z.object({
  normalizedName: z.string().trim().min(1).max(300),
  definition: z.string().trim().min(1).max(8_000),
  maturity: z.enum(["concept", "laboratory", "engineering_validation", "pilot", "commercial", "unknown"]),
  keyMetrics: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
  papers: z.array(z.string().trim().min(1).max(1_000)).max(300).default([]),
  patents: z.array(z.string().trim().min(1).max(1_000)).max(300).default([]),
  alternatives: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  competitors: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
}).strict();

export const intelligenceCandidateInputSchema = z.object({
  externalId: z.string().trim().min(1).max(200),
  entityType: z.enum(ENTITY_TYPES),
  candidateKind: z.enum(["new_entity", "entity_update"]),
  name: z.string().trim().min(1).max(300),
  track: z.enum(TRACKS),
  subtrack: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  signalType: z.string().trim().min(1).max(120),
  eventDate: z.iso.date(),
  channel: z.enum(DISCOVERY_CHANNELS),
  discoveryReason: z.string().trim().min(1).max(2_000),
  investmentSummary: z.string().trim().max(1_000),
  investmentHighlights: z.array(z.string().trim().min(1).max(500)).max(20),
  openQuestions: z.array(z.string().trim().min(1).max(500)).max(50),
  scores: candidateScoresSchema,
  evidence: z.array(candidateEvidenceSchema).max(100),
  assertions: z.array(candidateAssertionSchema).max(300),
  relationships: z.array(relationshipSchema).max(200),
  contacts: z.array(publicContactSchema).max(30),
  company: companyDetailsSchema.optional(),
  person: personDetailsSchema.optional(),
  technology: technologyDetailsSchema.optional(),
}).strict().superRefine((item, context) => {
  const refs = new Set(item.evidence.map((evidence) => evidence.ref));
  if (refs.size !== item.evidence.length) context.addIssue({ code: "custom", message: "来源 ref 不能重复。", path: ["evidence"] });
  for (const [index, assertion] of item.assertions.entries()) {
    for (const ref of assertion.evidenceRefs) if (!refs.has(ref)) context.addIssue({ code: "custom", message: `未知来源 ref：${ref}`, path: ["assertions", index, "evidenceRefs"] });
  }
  for (const [index, relationship] of item.relationships.entries()) {
    for (const ref of relationship.evidenceRefs) if (!refs.has(ref)) context.addIssue({ code: "custom", message: `实体关系缺少有效来源：${ref}`, path: ["relationships", index, "evidenceRefs"] });
  }
  for (const [index, event] of (item.company?.fundingHistory ?? []).entries()) {
    for (const ref of event.sourceRefs) if (!refs.has(ref)) context.addIssue({ code: "custom", message: `融资事件缺少有效来源：${ref}`, path: ["company", "fundingHistory", index, "sourceRefs"] });
  }
  for (const [index, event] of (item.company?.mergersAndAcquisitions ?? []).entries()) {
    for (const ref of event.sourceRefs) if (!refs.has(ref)) context.addIssue({ code: "custom", message: `并购事件缺少有效来源：${ref}`, path: ["company", "mergersAndAcquisitions", index, "sourceRefs"] });
  }
  for (const [index, contact] of item.contacts.entries()) {
    const source = item.evidence.find((evidence) => evidence.ref === contact.sourceRef);
    if (!source) context.addIssue({ code: "custom", message: `联系方式缺少有效来源：${contact.sourceRef}`, path: ["contacts", index, "sourceRef"] });
    else if (source.accessClass !== "public") context.addIssue({ code: "custom", message: "联系方式必须来自公开网页。", path: ["contacts", index, "sourceRef"] });
  }
  if (item.entityType === "company" && item.person) context.addIssue({ code: "custom", message: "公司候选不能包含人物详情。", path: ["person"] });
  if (item.entityType === "company" && item.technology) context.addIssue({ code: "custom", message: "公司候选不能包含技术详情。", path: ["technology"] });
  if (item.entityType === "person" && item.company) context.addIssue({ code: "custom", message: "人物候选不能包含公司详情。", path: ["company"] });
  if (item.entityType === "person" && item.technology) context.addIssue({ code: "custom", message: "人物候选不能包含技术详情。", path: ["technology"] });
  if (item.entityType === "technology" && item.company) context.addIssue({ code: "custom", message: "技术候选不能包含公司详情。", path: ["company"] });
  if (item.entityType === "technology" && item.person) context.addIssue({ code: "custom", message: "技术候选不能包含人物详情。", path: ["person"] });
});

export const candidateBundleBatchSchema = z.object({
  id: z.string().trim().min(1).max(200),
  createdAt: z.iso.datetime({ offset: true }),
  createdBy: z.string().trim().min(1).max(200),
  accessClass: z.enum(["public", "licensed_internal", "user_supplied"]),
  note: z.string().trim().max(2_000).optional(),
}).strict();

export const candidateBundleEnvelopeSchema = z.object({
  schemaVersion: z.literal("1.0"),
  batch: candidateBundleBatchSchema,
  items: z.array(z.unknown()).min(1).max(2_000),
}).strict();

export const candidateBundleSchema = candidateBundleEnvelopeSchema.extend({
  items: z.array(intelligenceCandidateInputSchema).min(1).max(2_000),
}).strict().superRefine((bundle, context) => {
  const evidence = bundle.items.flatMap((item) => item.evidence);
  if (bundle.batch.accessClass === "public" && evidence.some((item) => item.accessClass !== "public")) context.addIssue({ code: "custom", message: "公开批次不能包含受限资料。", path: ["batch", "accessClass"] });
  if (bundle.batch.accessClass === "user_supplied" && evidence.some((item) => item.accessClass === "licensed_internal")) context.addIssue({ code: "custom", message: "用户提供批次不能混入授权内部资料。", path: ["batch", "accessClass"] });
});

export type IntelligenceCandidateInput = z.infer<typeof intelligenceCandidateInputSchema>;
export type CandidateBundle = z.infer<typeof candidateBundleSchema>;

const coreFields: Record<EntityType, readonly string[]> = {
  company: ["products", "coreTechnology", "coreTeam", "competitors", "fundingHistory", "officialWebsite", "contacts"],
  person: ["education", "employment", "technicalBackground", "publications", "homepage", "contacts"],
  technology: ["definition", "maturity", "keyMetrics", "papersPatents", "relatedEntities", "alternatives", "competitors"],
};

export function computeCompleteness(candidate: Pick<IntelligenceCandidateInput, "entityType" | "name" | "track" | "signalType" | "eventDate" | "discoveryReason" | "evidence" | "assertions" | "investmentSummary" | "investmentHighlights" | "openQuestions" | "company" | "person" | "technology">): CompletenessLevel {
  const assertedIdentity = candidate.assertions.some((assertion) => assertion.valueStatus !== "unknown" && ["subjectIdentity", "legalName", "unifiedCreditCode", "officialWebsite", "organization", "homepage", "normalizedName", "definition"].includes(assertion.field));
  const detailedIdentity = Boolean(candidate.company?.legalName || candidate.company?.unifiedCreditCode || candidate.company?.officialWebsite || candidate.person?.organization || candidate.person?.homepage || candidate.technology?.normalizedName);
  const hasL1 = Boolean(candidate.name && candidate.track && candidate.signalType && candidate.eventDate && candidate.discoveryReason && candidate.evidence.length > 0 && (assertedIdentity || detailedIdentity));
  if (!hasL1) return "L0";
  const covered = new Set(candidate.assertions.filter((assertion) => assertion.valueStatus !== "unknown").map((assertion) => assertion.field));
  const summaryLength = Array.from(candidate.investmentSummary.trim()).length;
  const hasL2 = coreFields[candidate.entityType].every((field) => covered.has(field))
    && summaryLength >= 120 && summaryLength <= 300
    && candidate.investmentHighlights.length > 0 && candidate.openQuestions.length > 0;
  return hasL2 ? "L2" : "L1";
}

export function missingResearchFields(candidate: Pick<IntelligenceCandidateInput, "entityType" | "assertions">): string[] {
  const assertions = new Map(candidate.assertions.map((assertion) => [assertion.field, assertion]));
  return coreFields[candidate.entityType].filter((field) => !assertions.has(field) || assertions.get(field)?.valueStatus === "unknown");
}

export function normalizeScores(scores: CandidateScores, evidenceCounts: Record<keyof CandidateScores, number>): CandidateScores {
  return Object.fromEntries(Object.entries(scores).map(([dimension, score]) => [dimension, evidenceCounts[dimension as keyof CandidateScores] > 0 ? score : Math.min(score, 1)])) as unknown as CandidateScores;
}

export function priorityForCandidate(completeness: CompletenessLevel, scores: CandidateScores, hasAttentionPoint: boolean): PriorityBand {
  if (completeness !== "L0" && scores.evidence >= 4 && [scores.technology, scores.team, scores.commercial, scores.signal].filter((score) => score >= 4).length >= 2) return "A";
  if (completeness !== "L0" && hasAttentionPoint) return "B";
  return "C";
}

export function companyDedupeKeys(input: { unifiedCreditCode?: string; officialWebsite?: string; name: string; city?: string | null }): string[] {
  return compact([
    input.unifiedCreditCode ? `credit:${input.unifiedCreditCode.replace(/\s/gu, "").toUpperCase()}` : null,
    input.officialWebsite ? `domain:${normalizedDomain(input.officialWebsite)}` : null,
    input.city ? `name-city:${normalizeCompanyName(input.name)}|${normalizeText(input.city)}` : null,
  ]);
}

export function personDedupeKeys(input: { name: string; organization?: string; education?: readonly string[]; homepage?: string }): string[] {
  return compact([
    input.organization ? `person-org:${normalizeText(input.name)}|${normalizeText(input.organization)}` : null,
    input.education?.length ? `person-education:${normalizeText(input.name)}|${input.education.map(normalizeText).sort().join("|")}` : null,
    input.homepage ? `homepage:${normalizedDomain(input.homepage)}${new URL(input.homepage).pathname.replace(/\/$/u, "")}` : null,
  ]);
}

export function technologyDedupeKeys(input: { name: string; identifiers?: readonly string[]; topics?: readonly string[] }): string[] {
  return [
    `technology:${normalizeText(input.name)}`,
    ...(input.identifiers ?? []).map((identifier) => `identifier:${identifier.trim().toLocaleLowerCase("zh-CN")}`),
    ...(input.topics ?? []).map((topic) => `topic:${normalizeText(topic).toLocaleLowerCase("zh-CN")}`),
  ];
}

function normalizeText(value: string): string { return value.trim().replace(/[\s·•]/gu, ""); }
function normalizeCompanyName(value: string): string { return normalizeText(value).replace(/[（(](?:北京|上海|深圳|杭州|苏州|广州|合肥|武汉|成都|西安|南京|无锡)[）)]/gu, ""); }
function normalizedDomain(value: string): string { return new URL(value).hostname.toLocaleLowerCase("en-US").replace(/^www\./u, ""); }
function compact(values: Array<string | null>): string[] { return values.filter((value): value is string => Boolean(value)); }

function isUnsafeHostname(hostname: string): boolean {
  const normalized = hostname.toLocaleLowerCase("en-US").replace(/\.$/u, "");
  if (["localhost", "localhost.localdomain"].includes(normalized) || normalized.endsWith(".local") || normalized.endsWith(".internal")) return true;
  const literal = normalized.replace(/^\[|\]$/gu, "");
  if (ipaddr.isValid(literal)) {
    const parsed = ipaddr.parse(literal);
    if (parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) return (parsed as ipaddr.IPv6).toIPv4Address().range() !== "unicast";
    return parsed.range() !== "unicast";
  }
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(normalized);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return true;
  return octets[0] === 10 || octets[0] === 127 || octets[0] === 0
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || octets[0] >= 224;
}

export interface DiscoveryPlanDefinition {
  id: string;
  name: string;
  channel: Exclude<DiscoveryChannel, "manual_codex">;
  queryFamily: string;
  tracks: readonly Track[];
  subtracks: readonly string[];
  cities: readonly string[];
  preferredDomains: readonly string[];
  dateWindowDays: number;
  connectorType: "public_search" | "rss" | "licensed_api";
  enabled: boolean;
  schedule: { frequency: "daily" | "every_two_days" | "weekly"; time: string; weekdaysOnly: boolean; weekday?: number };
}

export const intelligenceScheduleSchema = z.object({
  frequency: z.enum(["daily", "every_two_days", "weekly"]),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u),
  weekdaysOnly: z.boolean(),
  weekday: z.number().int().min(0).max(6).optional(),
}).strict().superRefine((schedule, context) => {
  if (schedule.frequency === "weekly" && schedule.weekday === undefined) context.addIssue({ code: "custom", message: "每周计划必须指定星期。", path: ["weekday"] });
});

const preferredDomainSchema = z.string().trim().min(3).max(255).superRefine((value, context) => {
  if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/iu.test(value) || isUnsafeHostname(value)) context.addIssue({ code: "custom", message: "信源域名格式无效。" });
});

export const discoveryPlanUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  queryFamily: z.string().trim().min(2).max(1_000).optional(),
  tracks: z.array(z.enum(TRACKS)).min(1).max(TRACKS.length).optional(),
  subtracks: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
  cities: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
  preferredDomains: z.array(preferredDomainSchema).max(100).optional(),
  dateWindowDays: z.number().int().min(1).max(365).optional(),
  schedule: intelligenceScheduleSchema.optional(),
  expectedVersion: z.number().int().positive(),
}).strict();

export const defaultDiscoveryPlans: readonly DiscoveryPlanDefinition[] = [
  { id: "venture-tech", name: "创投与科技动态", channel: "venture_tech", queryFamily: "融资、投资、并购、产品发布与技术讨论", tracks: TRACKS, subtracks: [], cities: PRIORITY_CITIES, preferredDomains: ["36kr.com", "chinaventure.com.cn"], dateWindowDays: 2, connectorType: "public_search", enabled: true, schedule: { frequency: "daily", time: "05:30", weekdaysOnly: false } },
  { id: "registry", name: "工商科技企业", channel: "registry", queryFamily: "公开工商公示、科技企业设立、经营范围与工商变更（不检索登录或付费页面）", tracks: TRACKS, subtracks: [], cities: PRIORITY_CITIES, preferredDomains: ["gsxt.gov.cn"], dateWindowDays: 2, connectorType: "public_search", enabled: true, schedule: { frequency: "every_two_days", time: "06:00", weekdaysOnly: false } },
  { id: "hiring", name: "招聘增长信号", channel: "hiring", queryFamily: "企业官网招聘页的研发岗位新增、招聘规模变化与关键岗位（不检索登录型招聘平台）", tracks: TRACKS, subtracks: [], cities: PRIORITY_CITIES, preferredDomains: [], dateWindowDays: 2, connectorType: "public_search", enabled: true, schedule: { frequency: "every_two_days", time: "06:30", weekdaysOnly: false } },
  { id: "ranking-award", name: "榜单与奖项", channel: "ranking_award", queryFamily: "科技榜单、创新奖项、入选团队与人物", tracks: TRACKS, subtracks: [], cities: PRIORITY_CITIES, preferredDomains: [], dateWindowDays: 7, connectorType: "public_search", enabled: true, schedule: { frequency: "weekly", time: "05:00", weekdaysOnly: false, weekday: 0 } },
] as const;
