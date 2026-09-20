import { z } from "zod";

export type AvatarSubmission = {
  id: string; memberId: string; memberName: string; status: "pending" | "approved" | "rejected";
  version: number; avatarUrl: string; reviewNote: string; createdAt: string; reviewedAt: string | null;
};
export const officeAvatarReviewSchema = z.object({
  expectedVersion: z.number().int().positive(), decision: z.enum(["approve", "reject"]), note: z.string().trim().max(1000),
}).strict().refine(value => value.decision !== "reject" || value.note.length > 0, { message: "退回头像时请填写原因。", path: ["note"] });
export type AvatarReviewInput = z.input<typeof officeAvatarReviewSchema>;
