import { responsibleInputFields } from "./project-responsibles";
import { z } from "zod";
import { INSTITUTION_TYPE_VALUES, INVESTOR_STATUS_VALUES, TRACK_VALUES } from "@/domain/types";

export const projectStageSchema = z.enum(["new", "researching", "contacting", "dd", "ic", "pass", "invested", "exited"]);
export const projectScoreSchema = z.number().min(0).max(100).nullable();

export const currentUserSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  capabilities: z.array(z.string()),
}).strict();

export const teamMemberSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), role: z.string().min(1),
  tracks: z.array(z.enum(TRACK_VALUES)), subtracks: z.array(z.string()), currentLoad: z.number().int().nonnegative(),
  assignmentProfileKnown: z.boolean().optional(),
  departmentId: z.string().max(200).nullable().optional(), departmentName: z.string().max(200).nullable().optional(),
}).strict();

export const analysisProfileSchema = z.object({
  id: z.string().min(1), version: z.string().min(1), label: z.string().min(1), description: z.string(),
  agentRef: z.string().min(1), skillRefs: z.array(z.string()),
}).strict();

export const discoveryJobInputSchema = z.object({
  query: z.string().trim().min(3).max(1_000),
  channel: z.enum(["venture_tech", "registry", "hiring", "ranking_award"]).default("venture_tech"),
  queryFamily: z.string().trim().min(1).max(200).default("manual"),
  tracks: z.array(z.enum(TRACK_VALUES)).max(TRACK_VALUES.length).default([]),
  subtracks: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  cities: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  institutions: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  since: z.string().trim().max(40).optional(),
  dateWindowDays: z.number().int().min(1).max(365).default(1),
  preferredDomains: z.array(z.string().trim().regex(/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/iu)).max(100).default([]),
  sourceScope: z.enum(["approved_public", "licensed_internal", "all_approved"]).default("approved_public"),
  resultLimit: z.number().int().min(1).max(50).default(20),
}).strict();

export const candidateReviewSchema = z.object({
  decision: z.enum(["promote", "reject"]), expectedVersion: z.number().int().positive(), reason: z.string().trim().max(1_000).default(""),
  track: z.enum(TRACK_VALUES).optional(),
  ...responsibleInputFields,
}).strict().refine(input => !(input.assignee && input.assignees), "请只使用一种负责人选择方式。");

export const researchJobRequestSchema = z.object({
  projectId: z.string().min(1), profileId: z.string().min(1), skillRefs: z.array(z.string()).max(5).default([]),
  instructions: z.string().trim().max(4_000).default(""), expectedVersion: z.number().int().positive(),
}).strict();

export const judgmentInputSchema = z.object({
  expectedVersion: z.number().int().positive(), thesis: z.string().trim().min(2).max(8_000),
  stance: z.enum(["positive", "neutral", "cautious", "negative"]), occurredAt: z.string().datetime(),
}).strict();

export const knowledgeReviewSchema = z.object({
  decision: z.enum(["approve", "reject"]), expectedVersion: z.number().int().positive(), note: z.string().trim().max(1_000).default(""),
}).strict();

export const timelineEntrySchema = z.object({
  id: z.string(), projectId: z.string(), kind: z.enum(["fact", "document", "judgment", "research", "agent", "audit"]),
  title: z.string(), summary: z.string(), actor: z.string().nullable(), occurredAt: z.string(), metadata: z.unknown(),
}).strict();

// ── 机构名录 ────────────────────────────────────────────────────
const shortText = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => shortText(max).nullable().optional();
const dateLike = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}/, "日期须为 YYYY-MM-DD 或 ISO 时间。");

export const investorFundSizeSchema = z.object({
  amount: z.number().nonnegative().nullable(), currency: shortText(10).nullable(), text: shortText(200), source: optionalText(500),
}).strict();
export const investorKeyPersonSchema = z.object({ name: shortText(80).min(1), title: optionalText(80), focusTracks: z.array(shortText(40)).max(10).optional() }).strict();
export const investorPortfolioSampleSchema = z.object({ company: shortText(120).min(1), track: optionalText(40), year: z.number().int().min(1990).max(2100).nullable().optional(), round: optionalText(40) }).strict();
export const investorVerificationSchema = z.object({ verifiedAt: dateLike.nullable(), verifiedBy: shortText(80).nullable(), notes: shortText(2_000) }).strict();
export const investorTrackPerformanceSchema = z.record(z.string(), z.object({ invested: z.number().int().nonnegative(), followOnRate: z.number().min(0).max(1).nullable(), exits: z.number().int().nonnegative() }).strict());

export const investorInputSchema = z.object({
  name: shortText(120).min(1),
  englishName: optionalText(120),
  aliases: z.array(shortText(120)).max(20).optional(),
  institutionType: z.enum(INSTITUTION_TYPE_VALUES),
  headquarters: optionalText(80),
  focusTracks: z.array(z.enum(TRACK_VALUES)).max(TRACK_VALUES.length),
  subtracks: z.array(shortText(60)).max(30).optional(),
  stageFocus: z.array(shortText(30)).max(10).optional(),
  investmentStyle: optionalText(500),
  thesis: optionalText(2_000),
  keyPeople: z.array(investorKeyPersonSchema).max(30).optional(),
  portfolioSample: z.array(investorPortfolioSampleSchema).max(50).optional(),
  fundSize: investorFundSizeSchema.nullable().optional(),
  sourceRefs: z.array(shortText(1_000)).max(30).optional(),
  status: z.enum(INVESTOR_STATUS_VALUES).optional(),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  rank: z.number().int().positive().max(10_000).nullable().optional(),
  verification: investorVerificationSchema.nullable().optional(),
  notes: shortText(4_000).optional(),
  trackPerformance: investorTrackPerformanceSchema.optional(),
  extra: z.record(z.string(), z.string().max(2_000)).optional(),
}).strict();

export const investorUpdateSchema = investorInputSchema.partial().extend({ expectedVersion: z.number().int().positive() }).strict();

// ── 项目推进时间表 ──────────────────────────────────────────────
export const milestoneStatusSchema = z.enum(["planned", "in_progress", "done", "blocked", "cancelled"]);

export const milestoneInputSchema = z.object({
  stage: shortText(40).min(1),
  title: shortText(200).min(1),
  kind: shortText(60).default("custom"),
  status: milestoneStatusSchema.default("planned"),
  plannedAt: dateLike.nullable().default(null),
  occurredAt: dateLike.nullable().default(null),
  ownerId: shortText(80).nullable().default(null),
  conclusion: shortText(8_000).default(""),
}).strict();

export const milestoneUpdateSchema = z.object({
  expectedVersion: z.number().int().positive(),
  stage: shortText(40).min(1).optional(),
  title: shortText(200).min(1).optional(),
  kind: shortText(60).optional(),
  status: milestoneStatusSchema.optional(),
  plannedAt: dateLike.nullable().optional(),
  occurredAt: dateLike.nullable().optional(),
  ownerId: shortText(80).nullable().optional(),
  conclusion: shortText(8_000).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
}).strict();

export const milestoneAttachmentInputSchema = z.object({
  title: shortText(200).min(1),
  uri: shortText(2_000).nullable().default(null),
  documentId: shortText(80).nullable().default(null),
  note: shortText(2_000).default(""),
}).strict();

export const projectCommentInputSchema = z.object({
  body: shortText(8_000).min(1),
  milestoneId: shortText(80).nullable().default(null),
}).strict();

export const notificationReadSchema = z.object({ read: z.boolean().default(true) }).strict();

export type InvestorInput = z.infer<typeof investorInputSchema>;
export type InvestorUpdateInput = z.infer<typeof investorUpdateSchema>;
export type MilestoneStatus = z.infer<typeof milestoneStatusSchema>;
export type MilestoneInput = z.input<typeof milestoneInputSchema>;
export type MilestoneUpdateInput = z.input<typeof milestoneUpdateSchema>;
export type MilestoneAttachmentInput = z.input<typeof milestoneAttachmentInputSchema>;
export type ProjectCommentInput = z.input<typeof projectCommentInputSchema>;

export type CurrentUser = z.infer<typeof currentUserSchema>;
export type TeamMember = z.infer<typeof teamMemberSchema>;
export type AnalysisProfile = z.infer<typeof analysisProfileSchema>;
export type DiscoveryJobInput = z.infer<typeof discoveryJobInputSchema>;
export type TimelineEntry = z.infer<typeof timelineEntrySchema>;
