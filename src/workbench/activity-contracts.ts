import { z } from "zod";
import type { ProjectDocumentKind } from "./document-policy";

export type ActivityDocumentKind = ProjectDocumentKind | "image";

export interface WorkspaceActivityDocument {
  id: string;
  originalName: string;
  kind: ActivityDocumentKind;
  byteLength: number;
  createdAt: string;
  source?: "upload" | "project";
  projectId?: string;
  projectDocumentId?: string;
  projectName?: string;
}

export const activityInputSchema = z.object({
  kind: z.enum(["task", "meeting", "trip", "approval"]),
  approvalType: z.enum(["general", "reimbursement"]).optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).default(""),
  participantIds: z.array(z.string().trim().min(1).max(128)).max(500).default([]),
  dueAt: z.string().datetime().nullable().default(null),
  endAt: z.string().datetime().nullable().default(null),
  location: z.string().trim().max(300).default(""),
  projectId: z.string().trim().min(1).max(128).nullable().default(null),
  projectDocumentIds: z.array(z.string().trim().min(1).max(128)).max(20).default([]),
}).strict().superRefine((value, context) => {
  if (value.endAt && !value.dueAt) context.addIssue({ code: "custom", path: ["endAt"], message: "结束时间需要开始时间。" });
  if (value.dueAt && value.endAt) {
    const start = Date.parse(value.dueAt), end = Date.parse(value.endAt);
    if (end <= start) context.addIssue({ code: "custom", path: ["endAt"], message: "结束时间必须晚于开始时间。" });
    if (end - start > 7 * 86_400_000) context.addIssue({ code: "custom", path: ["endAt"], message: "单个日程不能超过七天。" });
  }
});
export const activityEditSchema = activityInputSchema.omit({ projectDocumentIds: true }).extend({ expectedVersion: z.number().int().positive() });

export const activityResponseSchema = z.object({
  action: z.enum(["accepted", "declined", "change_requested", "done", "approved", "returned"]),
  note: z.string().trim().max(2000).default(""),
  expectedVersion: z.number().int().positive(),
}).strict().refine((value) => !["change_requested", "returned"].includes(value.action) || value.note.length > 0, { message: "请填写调整或退回意见。" });

export interface WorkspaceActivity {
  id: string;
  kind: z.infer<typeof activityInputSchema>["kind"];
  approvalType?: "general" | "reimbursement";
  status?: "active" | "withdrawn" | "completed" | "archived";
  completedAt?: string | null;
  withdrawnAt?: string | null;
  archivedAt?: string | null;
  deletedAt?: string | null;
  archiveAt?: string | null;
  title: string;
  description: string;
  dueAt: string | null;
  endAt?: string | null;
  location: string;
  projectId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
  version: number;
  documents?: WorkspaceActivityDocument[];
  responses: Array<{ memberId: string; action: string; note: string; respondedAt: string | null; assignedAt?: string | null; viewedAt?: string | null }>;
  audit: Array<{ actorId: string; action: string; note: string; createdAt: string }>;
}

export interface ProjectFileOption {
  id: string; projectId: string; projectName: string; originalName: string;
  kind: ProjectDocumentKind; byteLength: number; createdAt: string;
}
