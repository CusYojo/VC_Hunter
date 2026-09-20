import { z } from "zod";

export const demoPersonaSchema = z.enum([
  "super_admin",
  "partner",
  "investment_director",
  "investment_manager",
  "researcher",
  "finance",
  "legal_compliance",
  "hr_admin",
  "viewer",
  "external_advisor",
]);
export type DemoPersona = z.infer<typeof demoPersonaSchema>;

export const entityRefSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["project", "fund", "trip", "institution", "person", "contract", "approval"]),
  label: z.string().min(1),
  href: z.string().startsWith("/").optional(),
});
export type EntityRef = z.infer<typeof entityRefSchema>;

export const workItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(["todo", "in_progress", "blocked", "done"]),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  assignee: z.string().min(1),
  dueAt: z.string().datetime(),
  project: entityRefSchema.optional(),
  response: z.enum(["pending", "accepted", "declined", "change_requested"]).optional(),
  source: z.literal("demo"),
});
export type WorkItem = z.infer<typeof workItemSchema>;

export const approvalTrailStepSchema = z.object({
  id: z.string().min(1),
  actor: z.string().min(1),
  action: z.enum(["submitted", "approved", "returned", "commented"]),
  note: z.string(),
  at: z.string().datetime(),
});

export const approvalRequestSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  requestType: z.enum(["project", "dd", "ic", "trip", "expense", "payment", "seal", "contract", "purchase", "leave"]),
  status: z.enum(["draft", "pending", "approved", "returned"]),
  applicant: z.string().min(1),
  currentApprover: z.string().min(1),
  submittedAt: z.string().datetime(),
  amountCny: z.number().nonnegative().optional(),
  entity: entityRefSchema.optional(),
  risk: z.enum(["normal", "attention", "high"]),
  summary: z.string().min(1),
  trail: z.array(approvalTrailStepSchema).min(1),
  source: z.literal("demo"),
});
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

export const meetingSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  startsAt: z.string().datetime(),
  location: z.string().min(1),
  attendees: z.array(z.string()),
  project: entityRefSchema.optional(),
  response: z.enum(["pending", "accepted", "declined", "change_requested"]).optional(),
  summaryStatus: z.enum(["scheduled", "processing", "ready"]),
  source: z.literal("demo"),
});
export type MeetingSummary = z.infer<typeof meetingSummarySchema>;

export const fundSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  vintage: z.number().int(),
  committedCny: z.number().nonnegative(),
  calledPercent: z.number().min(0).max(100),
  navCny: z.number().nonnegative(),
  dpi: z.number().nonnegative(),
  irrPercent: z.number(),
  portfolioCount: z.number().int().nonnegative(),
  source: z.literal("demo"),
});
export type FundSummary = z.infer<typeof fundSummarySchema>;

export const financeRecordSchema = z.object({
  id: z.string().min(1),
  recordType: z.enum(["expense", "invoice", "payment", "budget"]),
  title: z.string().min(1),
  amountCny: z.number().nonnegative(),
  status: z.enum(["draft", "pending", "approved", "paid", "overdue"]),
  occurredAt: z.string().datetime(),
  fund: entityRefSchema.optional(),
  project: entityRefSchema.optional(),
  trip: entityRefSchema.optional(),
  source: z.literal("demo"),
});
export type FinanceRecord = z.infer<typeof financeRecordSchema>;

export const contractSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  counterparty: z.string().min(1),
  status: z.enum(["draft", "review", "returned", "signing", "effective"]),
  riskCount: z.number().int().nonnegative(),
  owner: z.string().min(1),
  updatedAt: z.string().datetime(),
  project: entityRefSchema.optional(),
  source: z.literal("demo"),
});
export type ContractSummary = z.infer<typeof contractSummarySchema>;

export const agentRunSummarySchema = z.object({
  id: z.string().min(1),
  agent: z.string().min(1),
  task: z.string().min(1),
  status: z.enum(["queued", "running", "completed", "failed", "needs_review"]),
  startedAt: z.string().datetime(),
  durationSeconds: z.number().int().nonnegative().optional(),
  project: entityRefSchema.optional(),
  source: z.literal("demo"),
});
export type AgentRunSummary = z.infer<typeof agentRunSummarySchema>;

export const workflowSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
  trigger: z.string().min(1),
  steps: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    approver: z.string().min(1),
    condition: z.string().min(1),
  })).min(1),
  source: z.literal("demo"),
});
export type WorkflowSummary = z.infer<typeof workflowSummarySchema>;

export const prototypeStateSchema = z.object({
  version: z.literal(1),
  persona: demoPersonaSchema,
  workItems: z.array(workItemSchema),
  approvals: z.array(approvalRequestSchema),
  meetings: z.array(meetingSummarySchema),
  funds: z.array(fundSummarySchema),
  financeRecords: z.array(financeRecordSchema),
  contracts: z.array(contractSummarySchema),
  agentRuns: z.array(agentRunSummarySchema),
  workflows: z.array(workflowSummarySchema),
});
export type PrototypeState = z.infer<typeof prototypeStateSchema>;
