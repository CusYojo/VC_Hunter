import { z } from "zod";

export const researchBriefInputSchema = z.object({
  projectName: z.string().trim().min(1).max(300),
  track: z.string().trim().min(1).max(100),
  evidence: z.array(z.object({ id: z.string().min(1).max(200), quote: z.string().min(1).max(10_000), authority: z.enum(["A", "B", "C", "D"]) }).strict()).min(1).max(50),
  profile: z.object({ id: z.string().min(1).max(100), version: z.string().min(1).max(30), label: z.string().max(100), description: z.string().max(1_000) }).strict().optional(),
  skillRefs: z.array(z.string().min(1).max(160)).max(10).optional(),
  instructions: z.string().trim().max(2_000).optional(),
}).strict();

export const researchBriefSchema = z.object({
  summary: z.string().max(4_000),
  findings: z.array(z.object({ claim: z.string().max(2_000), evidenceIds: z.array(z.string().max(200)).min(1).max(20) }).strict()).max(30),
  risks: z.array(z.string().max(2_000)).max(30),
  openQuestions: z.array(z.string().max(2_000)).max(30),
}).strict();

export type ResearchBrief = z.infer<typeof researchBriefSchema>;
export type ResearchBriefInput = z.infer<typeof researchBriefInputSchema>;

export const discoveryInputSchema = z.object({
  query: z.string().trim().min(2).max(500),
  leads: z.array(z.object({ id: z.string().min(1).max(200), title: z.string().min(1).max(1_000), url: z.string().url().max(4_000), highlights: z.array(z.string().max(10_000)).max(20) }).strict()).min(1).max(20),
}).strict();

const signalTypeSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const aliases: Readonly<Record<string, string>> = { 融资: "funding", 投资: "investment", 领投: "investment", 参投: "investment", 并购: "ma", 收购: "ma", 里程碑: "milestone", 人才: "talent", 团队: "talent", 其他: "other" };
  return aliases[value.trim()] ?? value.trim();
}, z.enum(["funding", "investment", "ma", "milestone", "talent", "other"]));

const trackSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const aliases: Readonly<Record<string, string>> = { 人工智能: "AI", 机器人: "具身智能", 人形机器人: "具身智能", 具身机器人: "具身智能", 芯片: "半导体", 集成电路: "半导体", 功率半导体: "半导体", 聚变: "核聚变", 商业核聚变: "核聚变", 医药: "生物医药", 生物科技: "生物医药", 细胞与基因治疗: "生物医药", 航天: "商业航天", 卫星: "商业航天", 材料: "新材料" };
  return aliases[value.trim()] ?? value.trim();
}, z.enum(["AI", "具身智能", "半导体", "核聚变", "生物医药", "商业航天", "新材料"]));

export const discoveryAssessmentSchema = z.object({
  leadId: z.string().min(1).max(200), relevant: z.boolean(), companyName: z.string().trim().min(1).max(300).nullable(), track: trackSchema.nullable(),
  investorNames: z.array(z.string().trim().min(1).max(300)).max(20), signalType: signalTypeSchema, summary: z.string().max(2_000), confidence: z.number().min(0).max(1),
}).strict();
export const discoveryOutputSchema = z.object({ assessments: z.array(discoveryAssessmentSchema).max(20) }).strict();
export type DiscoveryLeadInput = z.infer<typeof discoveryInputSchema>["leads"][number];
export type DiscoveryLeadAssessment = z.infer<typeof discoveryAssessmentSchema>;

export function validateResearchBrief(input: ResearchBriefInput, brief: ResearchBrief): void {
  const allowedEvidence = new Set(input.evidence.map((evidence) => evidence.id));
  if (brief.findings.some((finding) => finding.evidenceIds.some((id) => !allowedEvidence.has(id)))) throw new Error("Model referenced unknown evidence.");
}

export function validateDiscoveryAssessments(leads: DiscoveryLeadInput[], assessments: DiscoveryLeadAssessment[]): void {
  const leadById = new Map(leads.map((lead) => [lead.id, lead]));
  if (assessments.length !== leads.length || new Set(assessments.map((item) => item.leadId)).size !== leads.length) throw new Error("Model must return exactly one assessment per lead.");
  for (const assessment of assessments) {
    const lead = leadById.get(assessment.leadId);
    if (!lead) throw new Error("Model referenced an unknown discovery lead.");
    const sourceText = `${lead.title}\n${lead.highlights.join("\n")}`;
    if (assessment.relevant && (!assessment.companyName || !assessment.track)) throw new Error("Relevant leads require a company and track.");
    if (assessment.companyName && !sourceText.includes(assessment.companyName)) throw new Error("Model returned an ungrounded company name.");
    if (assessment.investorNames.some((name) => !sourceText.includes(name))) throw new Error("Model returned an ungrounded investor name.");
  }
}
