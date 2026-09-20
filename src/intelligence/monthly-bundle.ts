import { z } from "zod";
import {
  candidateBundleSchema,
  DISCOVERY_CHANNELS,
  TRACKS,
  type CandidateBundle,
  type IntelligenceCandidateInput,
} from "./contracts";

const dateSchema = z.iso.date();
const httpsUrlSchema = z.url().refine((value) => new URL(value).protocol === "https:", "只允许 HTTPS URL。");

const researchEvidenceSchema = z.object({
  ref: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(500),
  url: httpsUrlSchema,
  publishedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  excerpt: z.string().trim().min(1).max(8_000),
  authority: z.enum(["A", "B", "C", "D"]),
  allowExternalModel: z.boolean().default(true),
}).strict();

const fundingDraftSchema = z.object({
  round: z.enum(["angel", "pre_a", "a", "b", "c", "d_plus", "strategic", "other"]),
  announcedAt: dateSchema,
  amount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  currency: z.enum(["CNY", "USD"]).optional(),
  disclosureType: z.enum(["exact", "range", "undisclosed", "estimated"]),
  valuation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  investors: z.array(z.string().trim().min(1).max(300)).max(100).default([]),
  leadInvestors: z.array(z.string().trim().min(1).max(300)).max(100).default([]),
  sourceRefs: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
}).strict();

const qccPublicFactsSchema = z.object({
  url: httpsUrlSchema,
  title: z.string().trim().min(1).max(500),
  excerpt: z.string().trim().min(1).max(8_000),
  legalName: z.string().trim().min(1).max(300),
  incorporationDate: dateSchema.optional(),
  registeredAddress: z.string().trim().min(1).max(1_000).optional(),
}).strict();

const monthlyResearchRecordSchema = z.object({
  externalId: z.string().trim().min(1).max(200),
  candidateKind: z.enum(["new_entity", "entity_update"]).default("new_entity"),
  name: z.string().trim().min(1).max(300),
  legalName: z.string().trim().min(1).max(300).optional(),
  track: z.enum(TRACKS),
  subtrack: z.string().trim().min(1).max(200),
  city: z.string().trim().min(1).max(120),
  eventDate: dateSchema,
  signalType: z.string().trim().min(1).max(120),
  signalSummary: z.string().trim().min(1).max(1_200),
  products: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
  coreTechnology: z.string().trim().min(1).max(2_000),
  teamSummary: z.string().trim().min(1).max(2_000).nullable().optional(),
  highlight: z.string().trim().min(1).max(500),
  question: z.string().trim().min(1).max(500),
  caveats: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  scores: z.object({
    technology: z.number().int().min(0).max(5),
    team: z.number().int().min(0).max(5),
    commercial: z.number().int().min(0).max(5),
    signal: z.number().int().min(0).max(5),
    evidence: z.number().int().min(0).max(5),
  }).strict(),
  officialWebsite: httpsUrlSchema.optional(),
  qccSearchUrl: httpsUrlSchema.optional(),
  qccPublicFacts: qccPublicFactsSchema.optional(),
  competitors: z.array(z.string().trim().min(1).max(300)).max(100).default([]),
  evidence: z.array(researchEvidenceSchema).min(1).max(99),
  founders: z.array(z.object({
    name: z.string().trim().min(1).max(300),
    role: z.string().trim().min(1).max(120),
    evidenceRef: z.string().trim().min(1).max(120),
  }).strict()).max(30).default([]),
  funding: fundingDraftSchema.optional(),
}).strict();

export const monthlyResearchDraftSchema = z.object({
  batchId: z.string().trim().min(1).max(200),
  windowFrom: dateSchema,
  windowTo: dateSchema,
  records: z.array(monthlyResearchRecordSchema).min(1).max(2_000),
}).strict().superRefine((draft, context) => {
  if (draft.windowFrom > draft.windowTo) context.addIssue({ code: "custom", message: "时间窗起始日期不能晚于结束日期。", path: ["windowFrom"] });
  draft.records.forEach((record, index) => {
    if (record.eventDate < draft.windowFrom || record.eventDate > draft.windowTo) {
      context.addIssue({ code: "custom", message: `事件日期不在时间窗内：${record.name}`, path: ["records", index, "eventDate"] });
    }
  });
});

export type MonthlyResearchDraft = z.input<typeof monthlyResearchDraftSchema>;

type BuildOptions = { createdAt: string; observedAt: string; createdBy: string };

export function buildMonthlyCandidateBundle(input: MonthlyResearchDraft, options: BuildOptions): CandidateBundle {
  const draft = monthlyResearchDraftSchema.parse(input);
  z.iso.datetime({ offset: true }).parse(options.createdAt);
  z.iso.datetime({ offset: true }).parse(options.observedAt);
  const items = draft.records.map((record) => buildCandidate(record, options.observedAt));
  return candidateBundleSchema.parse({
    schemaVersion: "1.0",
    batch: {
      id: draft.batchId,
      createdAt: options.createdAt,
      createdBy: options.createdBy,
      accessClass: "public",
      note: `公开信息月度初筛；事件窗口 ${draft.windowFrom} 至 ${draft.windowTo}。企查查未授权入口仅供人工核验，不作为工商事实证据。`,
    },
    items,
  });
}

type ParsedRecord = z.output<typeof monthlyResearchRecordSchema>;

function buildCandidate(record: ParsedRecord, observedAt: string): IntelligenceCandidateInput {
  const primaryRef = record.evidence[0].ref;
  const evidence: IntelligenceCandidateInput["evidence"] = record.evidence.map((item) => ({
    ...item,
    observedAt,
    accessClass: "public",
    collectionMethod: "codex",
  }));
  if (record.qccPublicFacts) evidence.push({
    ref: "qcc-public",
    title: record.qccPublicFacts.title,
    url: record.qccPublicFacts.url,
    publishedAt: null,
    observedAt,
    excerpt: record.qccPublicFacts.excerpt,
    authority: "C",
    accessClass: "public",
    collectionMethod: "codex",
    allowExternalModel: false,
  });
  if (record.qccSearchUrl && !record.qccPublicFacts) evidence.push({
    ref: "qcc-manual",
    title: `企查查人工核验入口｜${record.legalName ?? record.name}`,
    url: record.qccSearchUrl,
    publishedAt: null,
    observedAt,
    excerpt: "仅作为管理员人工核验入口；本次未自动抓取页面，也未据此填写工商事实。",
    authority: "D",
    accessClass: "public",
    collectionMethod: "codex",
    allowExternalModel: false,
  });

  const legalNameRef = record.qccPublicFacts ? "qcc-public" : primaryRef;
  const assertions: IntelligenceCandidateInput["assertions"] = [
    fact("subjectIdentity", "主体身份", record.legalName ?? record.name, [primaryRef], 0.9),
    ...(record.legalName ? [fact("legalName", "工商主体名称", record.legalName, [legalNameRef], record.qccPublicFacts ? 0.9 : 0.85)] : []),
    ...(record.qccPublicFacts?.incorporationDate ? [fact("incorporationDate", "成立日期", record.qccPublicFacts.incorporationDate, ["qcc-public"], 0.85)] : []),
    ...(record.qccPublicFacts?.registeredAddress ? [fact("registeredAddress", "注册地址", record.qccPublicFacts.registeredAddress, ["qcc-public"], 0.8)] : []),
    fact("products", "主要产品", record.products, [primaryRef], 0.8),
    fact("coreTechnology", "核心技术", record.coreTechnology, [primaryRef], 0.75),
    record.teamSummary ? fact("coreTeam", "核心团队", record.teamSummary, [primaryRef], 0.75) : unknown("coreTeam", "核心团队"),
    record.funding ? fact("fundingHistory", "融资历史", record.signalSummary, record.funding.sourceRefs, 0.85) : unknown("fundingHistory", "融资历史/交割"),
    record.officialWebsite ? fact("officialWebsite", "官方网站", record.officialWebsite, [primaryRef], 0.8) : unknown("officialWebsite", "官方网站"),
    record.competitors.length > 0 ? fact("competitors", "竞品公司", record.competitors, [primaryRef], 0.6) : unknown("competitors", "竞品公司"),
    unknown("contacts", "公开工作联系方式"),
  ];

  const summary = investmentSummary(record);
  const openQuestions = [record.question, ...record.caveats];
  if (record.qccSearchUrl || record.qccPublicFacts) openQuestions.push("通过企查查授权接口或国家企业信用信息公示系统复核信用代码、股东、变更与注册地址。");

  return {
    externalId: record.externalId,
    entityType: "company",
    candidateKind: record.candidateKind,
    name: record.name,
    track: record.track,
    subtrack: record.subtrack,
    city: record.city,
    signalType: record.signalType,
    eventDate: record.eventDate,
    channel: DISCOVERY_CHANNELS[4],
    discoveryReason: record.signalSummary,
    investmentSummary: summary,
    investmentHighlights: [record.highlight],
    openQuestions,
    scores: record.scores,
    evidence,
    assertions,
    relationships: record.founders.map((founder) => ({
      entityType: "person",
      name: founder.name,
      relation: founder.role,
      confidence: 0.75,
      evidenceRefs: [founder.evidenceRef],
    })),
    contacts: [],
    company: {
      ...(record.legalName ? { legalName: record.legalName } : {}),
      ...(record.qccPublicFacts?.incorporationDate ? { incorporationDate: record.qccPublicFacts.incorporationDate } : {}),
      ...(record.qccPublicFacts?.registeredAddress ? { registeredAddress: record.qccPublicFacts.registeredAddress } : {}),
      ...(record.officialWebsite ? { officialWebsite: record.officialWebsite } : {}),
      researchLocations: [record.city],
      products: record.products,
      coreTechnologies: [record.coreTechnology],
      competitors: record.competitors,
      fundingHistory: record.funding ? [record.funding] : [],
      mergersAndAcquisitions: [],
    },
  };
}

function fact(field: string, label: string, value: unknown, evidenceRefs: string[], confidence: number): IntelligenceCandidateInput["assertions"][number] {
  return { field, label, valueStatus: "known", epistemicType: "fact", value, confidence, evidenceRefs };
}

function unknown(field: string, label: string): IntelligenceCandidateInput["assertions"][number] {
  return { field, label, valueStatus: "unknown", epistemicType: "fact", confidence: 0, evidenceRefs: [] };
}

function investmentSummary(record: ParsedRecord): string {
  const raw = `${record.name}聚焦${record.subtrack}，核心方向为${record.coreTechnology}。近月公开信号显示：${record.signalSummary}投资亮点是${record.highlight}；关键待核问题是${record.question}。当前判断基于公开公告、官网或主流报道，尚未取得完整交易文件与授权工商底档，正式跟进前仍需核验融资交割、股权结构、知识产权归属以及关键技术和商业指标。`;
  if (raw.length >= 120 && raw.length <= 300) return raw;
  if (raw.length < 120) return `${raw}同时应补充客户访谈和竞品对标。`;
  return `${raw.slice(0, 297)}…`;
}
