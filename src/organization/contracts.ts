import { z } from "zod";
import { ORGANIZATION_ROLE_VALUES, type OrganizationRole } from "@/security/roles";
import { usernameSchema } from "@/auth/username";

export type Department = { id: string; name: string; parentId: string | null; expectedHeadcount: number | null; notes: string; sortOrder: number; version: number };
export type Member = { id: string; accountId: string | null; name: string; username: string | null; title: string; departmentId: string | null; phone: string; email: string; wechat: string; active: boolean; roles: OrganizationRole[]; isPlaceholder: boolean; sourceNotes: string; version: number };
export type Directory = { departments: Department[]; members: Member[] };
export type PublicMember = Pick<Member, "id" | "name" | "title" | "departmentId" | "active" | "isPlaceholder" | "version">;
export type PublicDirectory = { departments: Department[]; members: PublicMember[] };
export type OrganizationActor = { accountId: string; tenantId: string };
const id = z.string().min(1).max(128);
const text = (max: number) => z.string().trim().max(max);
const roles = z.array(z.enum(ORGANIZATION_ROLE_VALUES)).min(1).max(5).refine((values) => new Set(values).size === values.length);
const departmentFields = { name: text(100).min(1), parentId: id.nullable(), expectedHeadcount: z.number().int().min(0).max(10_000).nullable(), notes: text(2000), sortOrder: z.number().int().min(0).max(100_000) };
export const createDepartmentSchema = z.object(departmentFields).strict();
export const updateDepartmentSchema = createDepartmentSchema.partial().extend({ expectedVersion: z.number().int().min(1) }).strict();
export const updateMemberSchema = z.object({ name: text(100).min(1), title: text(100), departmentId: id.nullable(), phone: text(100), email: z.union([z.literal(""), z.email().max(254)]), wechat: text(100), roles, active: z.boolean() }).partial().extend({ expectedVersion: z.number().int().min(1) }).strict();
export type CreateDepartmentInput = z.input<typeof createDepartmentSchema>;
export type UpdateDepartmentInput = z.input<typeof updateDepartmentSchema>;
export type UpdateMemberInput = z.input<typeof updateMemberSchema>;
export const rosterSchema = z.object({ tenantId: id, departments: z.array(createDepartmentSchema.extend({ id })).max(500), members: z.array(z.object({
  id, name: text(100).min(1), username: usernameSchema.nullable(), title: text(100), departmentId: id.nullable(), isPlaceholder: z.boolean(), sourceNotes: text(2000),
}).strict()).max(2000) }).strict();
export type OrganizationRoster = z.input<typeof rosterSchema>;
export class OrganizationError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); this.name = "OrganizationError"; }
}
