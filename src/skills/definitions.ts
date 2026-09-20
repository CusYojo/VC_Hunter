import { z } from "zod";
import type { SkillDefinition } from "./contract";

/**
 * 八个标准 Skill 的稳定契约与版本化 Prompt。
 *
 * 每个 skill 的 systemPrompt 都是可独立版本化的实现，输入/输出 Schema 是稳定契约。
 * 失败处理遵循 PRD：无证据输出 unknown，禁止臆造；遇到限制返回 BLOCKED，禁止绕过。
 */

const trackEnum = z.enum(["AI", "具身智能", "半导体", "核聚变", "生物医药", "商业航天", "新材料"]);

// ── 1. collect_data ──────────────────────────────────────────────
const collectInput = z.object({
  tracks: z.array(trackEnum).min(1).max(7),
  since: z.string().trim().min(1).max(40),
  queryFamilies: z.array(z.enum(["Financing", "NewCompany", "TechnologyMilestone", "Patent", "Paper", "Talent", "Hiring", "Customer", "M&A", "Risk"])).min(1).max(10),
  maxResultsPerQuery: z.number().int().min(1).max(50).optional(),
}).strict();
const collectOutput = z.object({
  documents: z.array(z.object({
    title: z.string().max(1_000),
    url: z.string().url().max(4_000),
    publishedAt: z.string().max(40),
    sourceType: z.string().max(100),
    authority: z.enum(["A", "B", "C", "D"]),
    eventType: z.string().max(100),
    mentionedEntities: z.array(z.string().max(300)).max(100),
    summary: z.string().max(4_000),
  }).strict()).max(200),
  nextRunAt: z.string().max(40).optional(),
}).strict();

// ── 2. clean_data ────────────────────────────────────────────────
const cleanInput = z.object({
  documents: z.array(z.object({ rawText: z.string().min(1).max(100_000), sourceType: z.string().max(100), url: z.string().url().max(4_000).optional() }).strict()).min(1).max(200),
}).strict();
const cleanOutput = z.object({
  documents: z.array(z.object({
    title: z.string().max(1_000),
    body: z.string().max(100_000),
    publishedAt: z.string().max(40).nullable(),
    extractedAmounts: z.array(z.object({ value: z.number(), currency: z.enum(["CNY", "USD"]), raw: z.string().max(200) }).strict()).max(50),
    mentionedCompanies: z.array(z.string().max(300)).max(100),
    mentionedPeople: z.array(z.string().max(300)).max(100),
  }).strict()).max(200),
  dropped: z.number().int().nonnegative(),
}).strict();

// ── 3. resolve_entities ──────────────────────────────────────────
const resolveInput = z.object({
  mentions: z.array(z.object({ raw: z.string().max(300), kind: z.enum(["company", "person", "investor"]) }).strict()).min(1).max(500),
  candidates: z.array(z.object({ id: z.string().max(200), name: z.string().max(300), aliases: z.array(z.string().max(300)).max(50), kind: z.enum(["company", "person", "investor"]) }).strict()).max(1_000).optional(),
}).strict();
const resolveOutput = z.object({
  matches: z.array(z.object({ mention: z.string().max(300), entityId: z.string().max(200).nullable(), score: z.number().min(0).max(1), ambiguous: z.boolean() }).strict()).max(500),
  unresolved: z.array(z.string().max(300)).max(500),
}).strict();

// ── 4. enrich_project ────────────────────────────────────────────
const enrichInput = z.object({
  projectId: z.string().max(200),
  projectName: z.string().max(300),
  track: trackEnum,
  missingFields: z.array(z.enum(["technology", "market_size", "valuation", "revenue", "team", "competitors", "investor_performance", "patent_paper", "hiring"])).min(1),
}).strict();
const enrichOutput = z.object({
  fields: z.array(z.object({
    field: z.string().max(100),
    valueStatus: z.enum(["known", "unknown", "not_disclosed", "not_applicable", "estimated"]),
    value: z.unknown().optional(),
    nullReason: z.string().max(1_000).optional(),
    method: z.string().max(1_000).optional(),
    evidenceIds: z.array(z.string().max(200)).max(50),
  }).strict()).max(20),
}).strict();

// ── 5. analyze_project ──────────────────────────────────────────
const analyzeInput = z.object({
  projectId: z.string().max(200),
  projectName: z.string().max(300),
  track: trackEnum,
  evidence: z.array(z.object({ id: z.string().max(200), quote: z.string().max(10_000), authority: z.enum(["A", "B", "C", "D"]) }).strict()).min(1).max(50),
}).strict();
const analyzeOutput = z.object({
  summary: z.string().max(4_000),
  technology: z.object({ stage: z.string().max(300), rationale: z.string().max(4_000), openQuestions: z.array(z.string().max(1_000)).max(30) }).strict(),
  market: z.object({ tam: z.string().max(1_000).nullable(), rationale: z.string().max(4_000), openQuestions: z.array(z.string().max(1_000)).max(30) }).strict(),
  team: z.object({ strengths: z.array(z.string().max(1_000)).max(30), gaps: z.array(z.string().max(1_000)).max(30) }).strict(),
  competitiveMoat: z.string().max(4_000),
  risks: z.array(z.string().max(1_000)).max(30),
  evidenceIds: z.array(z.string().max(200)).max(50),
}).strict();

// ── 6. build_talent_profile ─────────────────────────────────────
const talentInput = z.object({
  personName: z.string().max(300),
  evidence: z.array(z.object({ id: z.string().max(200), quote: z.string().max(10_000), authority: z.enum(["A", "B", "C", "D"]) }).strict()).min(1).max(30),
}).strict();
const talentOutput = z.object({
  currentOrganization: z.string().max(300).nullable(),
  title: z.string().max(300).nullable(),
  track: trackEnum.nullable(),
  careerSummary: z.string().max(4_000),
  previousStartups: z.array(z.string().max(300)).max(50),
  technicalHighlights: z.array(z.string().max(1_000)).max(50),
  evidenceIds: z.array(z.string().max(200)).max(30),
}).strict();

// ── 7. generate_knowledge_card ──────────────────────────────────
const knowledgeInput = z.object({ topic: z.string().max(300), track: trackEnum.nullable() }).strict();
const knowledgeOutput = z.object({
  definition: z.string().max(4_000),
  summary: z.string().max(4_000),
  technicalRoutes: z.array(z.string().max(1_000)).max(50),
  keyMetrics: z.array(z.string().max(1_000)).max(100),
  synonyms: z.array(z.string().max(300)).max(100),
  keywords: z.array(z.string().max(300)).max(100),
  searchQueries: z.array(z.string().max(1_000)).max(100),
}).strict();

// ── 8. write_research_report ────────────────────────────────────
const reportInput = z.object({
  projectId: z.string().max(200),
  projectName: z.string().max(300),
  track: trackEnum,
  assertions: z.array(z.object({ label: z.string().max(300), valueStatus: z.string().max(100), value: z.unknown().optional(), evidenceIds: z.array(z.string().max(200)).max(50) }).strict()).min(1).max(200),
}).strict();
const reportOutput = z.object({
  executiveSummary: z.string().max(8_000),
  findings: z.array(z.object({ claim: z.string().max(2_000), evidenceIds: z.array(z.string().max(200)).max(50) }).strict()).max(100),
  openQuestions: z.array(z.string().max(1_000)).max(100),
  nextSteps: z.array(z.string().max(1_000)).max(100),
}).strict();

export const SKILL_DEFINITIONS = {
  collect_data: {
    id: "collect_data",
    version: "1.0.0",
    promptVersion: "p1",
    description: "在指定赛道和时间窗内检索新的融资、产品、技术、招聘、专利和人员变化；原始来源优先。",
    requiresModel: true,
    inputSchema: collectInput,
    outputSchema: collectOutput,
    systemPrompt: [
      "你是中国硬科技项目发现 Agent，负责在公开渠道检索新的项目、创始人、技术与投融资线索。",
      "规则：",
      "1. 原始来源优先，媒体转载只作为发现线索，不作为事实唯一证据。",
      "2. 只输出真实存在于输入范围内的结果，不得编造公司、金额或事件。",
      "3. 每个文档都要标注来源类型与权威等级（A 官方/B 招聘与学术/C 媒体/D 自媒体）。",
      "4. 输出 JSON，字段遵循 Schema。",
    ].join("\n"),
  } satisfies SkillDefinition,
  clean_data: {
    id: "clean_data",
    version: "1.0.0",
    promptVersion: "p1",
    description: "对文档做正文抽取、时间/金额/币种标准化、转载聚类和语言清洗。",
    requiresModel: true,
    inputSchema: cleanInput,
    outputSchema: cleanOutput,
    systemPrompt: [
      "你是中文硬科技文档清洗 Agent。",
      "规则：",
      "1. 金额与日期单独校验；无法确定的金额不要猜，宁可留空。",
      "2. 公司与人名按原文保留，不做主观合并。",
      "3. 无法解析的文档不得丢弃原文；用 dropped 计数记录。",
      "4. 输出 JSON，字段遵循 Schema。",
    ].join("\n"),
  } satisfies SkillDefinition,
  resolve_entities: {
    id: "resolve_entities",
    version: "1.0.0",
    promptVersion: "p1",
    description: "识别公司、人、机构并映射已有实体；不得将同名实体强行合并。",
    requiresModel: true,
    inputSchema: resolveInput,
    outputSchema: resolveOutput,
    systemPrompt: [
      "你是中文硬科技实体链接 Agent。",
      "规则：",
      "1. 同名企业/人物不得强行合并，宁可返回 ambiguous=true 并留空 entityId。",
      "2. 曾用名、简称、英文名可映射到同一实体。",
      "3. 置信度不足时必须标 ambiguous，不得硬匹配。",
      "4. 输出 JSON，字段遵循 Schema。",
    ].join("\n"),
  } satisfies SkillDefinition,
  enrich_project: {
    id: "enrich_project",
    version: "1.0.0",
    promptVersion: "p1",
    description: "针对项目缺失字段制定查询计划，补充近 24 个月技术、市场、估值、营收、团队、竞品等。",
    requiresModel: true,
    inputSchema: enrichInput,
    outputSchema: enrichOutput,
    systemPrompt: [
      "你是中国硬科技项目信息补全 Agent。",
      "规则：",
      "1. 没有证据不等于答案为否：搜不到营收应输出 not_disclosed，而不是零。",
      "2. 估算必须标 estimated 并给出 method 与区间，禁止伪精确值。",
      "3. 每个字段都要挂 evidenceIds；无证据时输出 unknown 并给 nullReason。",
      "4. 输出 JSON，字段遵循 Schema。",
    ].join("\n"),
  } satisfies SkillDefinition,
  analyze_project: {
    id: "analyze_project",
    version: "1.0.0",
    promptVersion: "p1",
    description: "基于数据库事实生成技术、市场、团队、竞争与风险的结构化分析。",
    requiresModel: true,
    inputSchema: analyzeInput,
    outputSchema: analyzeOutput,
    systemPrompt: [
      "你是中国硬科技 VC 投研分析 Agent。",
      "规则：",
      "1. 只使用用户提供的证据，事实与推断分离，任何关键结论都要挂 evidenceIds。",
      "2. 技术阶段要结合赛道特点（半导体看流片/量产，生物医药看临床阶段）。",
      "3. 估值与营收无法证实时写 null 并转入 openQuestions，不补写数字。",
      "4. 输出 JSON，字段遵循 Schema。",
    ].join("\n"),
  } satisfies SkillDefinition,
  build_talent_profile: {
    id: "build_talent_profile",
    version: "1.0.0",
    promptVersion: "p1",
    description: "基于公开职业信息生成人物画像，仅保留与投资研究直接相关的职业公开信息。",
    requiresModel: true,
    inputSchema: talentInput,
    outputSchema: talentOutput,
    systemPrompt: [
      "你是硬科技人才研究 Agent。",
      "规则：",
      "1. 只处理公开职业信息（组织、职务、专利论文、创业经历），不得推断住址、家庭、健康、金融账户等敏感信息。",
      "2. 无法确认的组织与头衔写 null，不得臆造。",
      "3. 每条结论挂 evidenceIds。",
      "4. 输出 JSON，字段遵循 Schema。",
    ].join("\n"),
  } satisfies SkillDefinition,
  generate_knowledge_card: {
    id: "generate_knowledge_card",
    version: "1.0.0",
    promptVersion: "p1",
    description: "为赛道/关键词生成定义、产业链、技术路线、性能指标、同义词和搜索词。",
    requiresModel: true,
    inputSchema: knowledgeInput,
    outputSchema: knowledgeOutput,
    systemPrompt: [
      "你是硬科技知识卡生成 Agent。",
      "规则：",
      "1. 输出定义、技术路线、关键指标、同义词、中英文关键词与搜索 Query 模板。",
      "2. 有专家争议的内容保留多路线，不强行唯一化。",
      "3. 输出 JSON，字段遵循 Schema。",
    ].join("\n"),
  } satisfies SkillDefinition,
  write_research_report: {
    id: "write_research_report",
    version: "1.0.0",
    promptVersion: "p1",
    description: "基于数据库事实生成 IC 风格项目报告，事实与推断分离，每个关键结论附证据。",
    requiresModel: true,
    inputSchema: reportInput,
    outputSchema: reportOutput,
    systemPrompt: [
      "你是中国硬科技 VC 投资研究报告撰写 Agent。",
      "规则：",
      "1. 只能使用输入中的 assertions 与 evidenceIds，不得引用不存在的证据。",
      "2. 事实与推断分离；证据不足的结论进入 openQuestions，不补写事实。",
      "3. 输出 IC 风格报告 JSON，字段遵循 Schema。",
    ].join("\n"),
  } satisfies SkillDefinition,
} as const;

export type SkillId = keyof typeof SKILL_DEFINITIONS;

export function listSkillDefinitions(): Array<{ id: string; version: string; promptVersion: string; description: string; requiresModel: boolean }> {
  return Object.values(SKILL_DEFINITIONS).map(({ id, version, promptVersion, description, requiresModel }) => ({
    id,
    version,
    promptVersion,
    description,
    requiresModel,
  }));
}

export function getSkillDefinition(id: string): SkillDefinition | undefined {
  return (SKILL_DEFINITIONS as Record<string, SkillDefinition>)[id];
}
