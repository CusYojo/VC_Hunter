import { z } from "zod";
import type { WorkspaceActivityDocument } from "./activity-contracts";
export const activityCommentInputSchema = z.object({
  body: z.string().trim().max(10000).default(""),
  parentId: z.string().uuid().nullable().default(null),
  projectDocumentIds: z.array(z.string().trim().min(1).max(128)).max(20).default([]),
}).strict();
export interface ActivityComment {
  id: string; sequence: number; activityId: string; parentId: string | null;
  deletedAt?: string | null; canDelete?: boolean;
  authorId: string; body: string; createdAt: string; documents: WorkspaceActivityDocument[];
}
export interface ActivityCommentPage { items: ActivityComment[]; hasMore: boolean; nextCursor: number | null }
