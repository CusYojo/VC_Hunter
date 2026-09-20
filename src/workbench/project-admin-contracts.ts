import { z } from "zod";
import { TRACK_VALUES } from "@/domain/types";

const projectFields = {
  name: z.string().trim().min(1).max(200),
  legalName: z.string().trim().min(1).max(200).optional(),
  track: z.enum(TRACK_VALUES),
  subtrack: z.string().trim().max(200).optional(),
  executiveSummary: z.string().trim().max(10000).optional(),
  technologyStage: z.string().trim().max(200).optional(),
  discoveryReason: z.string().trim().max(4000).optional(),
  status: z.enum(["new", "researching", "contacting", "dd", "ic", "pass", "invested", "exited"]).optional(),
  signalType: z.string().trim().min(1).max(120).optional(),
  riskFlags: z.array(z.string().trim().min(1).max(1000)).max(50).optional(),
  openQuestions: z.array(z.string().trim().min(1).max(1000)).max(50).optional(),
};
export const createAdminProjectSchema = z.object(projectFields).strict();
export const updateAdminProjectSchema = createAdminProjectSchema.omit({ legalName: true }).partial()
  .extend({ expectedVersion: z.number().int().positive() }).strict()
  .refine(value => Object.keys(value).some(key => key !== "expectedVersion"), "请修改至少一项内容。");
export type AdminProjectInput = z.infer<typeof createAdminProjectSchema>;
