import { z } from "zod";

export type OfficeActor = { tenantId: string; accountId: string; memberId: string; canManage: boolean };
export type OfficeGroupingMode = "project" | "department";
export type OfficeDeskShape = "classic" | "corner" | "round";
export type OfficePresenceStatus = "office" | "away" | "trip" | "custom";
export type OfficeStyle = { version: number; deskColor: string; deskShape: OfficeDeskShape; avatarUrl: string | null };
export type OfficeProfile = { version: number; groupingMode: OfficeGroupingMode; displayedProjectId: string | null; description: string; presenceStatus: OfficePresenceStatus; customStatus: string };
export type OfficeProgress = { done: number; total: number };
export type OfficeUpdate = { title: string; at: string };
export type OfficeProject = { id: string; name: string; stage: string; role: string; progress: OfficeProgress; latestUpdate: OfficeUpdate | null };
export type OfficeTask = { id: string; title: string; kind: string; action: string; dueAt: string | null; projectId: string | null };
export type OfficeMember = { id: string; name: string; title: string; departmentId: string | null; departmentName: string; groupIds: string[]; style: OfficeStyle; profile: OfficeProfile; projects: OfficeProject[]; tasks: OfficeTask[] };
export type OfficeSeat = { memberId: string; x: number; y: number };
export type OfficeGroup = { id: string; label: string; kind: "project" | "department"; projectId: string | null; departmentId: string | null; stage: string | null; progress: OfficeProgress; latestUpdate: OfficeUpdate | null; seats: OfficeSeat[] };
export type OfficeDepartment = { id: string; name: string; groupingMode: OfficeGroupingMode };
export type OfficeTodo = { id: string; kind: string; title: string; memberIds: string[]; dueAt: string | null; targetUrl: string };
export type OfficeQueue = { id: string; kind: "approval" | "comment"; title: string; fromMemberId: string; toMemberId: string; targetUrl: string; createdAt: string };
export type OfficeMeeting = { id: string; title: string; memberIds: string[]; startsAt: string; targetUrl: string; version?: number; canEnd?: boolean };
export type OfficeActivity = { todos: OfficeTodo[]; queues: OfficeQueue[]; meetings: OfficeMeeting[] };
export type OfficeWorkspace = { selfMemberId: string; canManage: boolean; layoutVersion: number; groupingMode: OfficeGroupingMode; departments: OfficeDepartment[]; members: OfficeMember[]; groups: OfficeGroup[]; activity?: OfficeActivity };
const id = z.string().trim().min(1).max(160);
export const officeStyleSchema = z.object({ expectedVersion: z.number().int().positive(), deskColor: z.string().regex(/^#[0-9a-fA-F]{6}$/), deskShape: z.enum(["classic", "corner", "round"]) }).strict();
const cleanLine = (max: number) => z.string().trim().max(max).refine(value => !/[\u0000-\u001f\u007f]/.test(value), "不能包含控制字符");
export const officeProfileSchema = z.object({
  expectedVersion: z.number().int().positive(), groupingMode: z.enum(["department", "project"]),
  displayedProjectId: id.nullable(), description: cleanLine(160), presenceStatus: z.enum(["office", "away", "trip", "custom"]),
  customStatus: cleanLine(32),
}).strict().superRefine((value, context) => {
  if (value.presenceStatus === "custom" && !value.customStatus) context.addIssue({ code: "custom", path: ["customStatus"], message: "自定义状态不能为空" });
  if (value.presenceStatus !== "custom" && value.customStatus) context.addIssue({ code: "custom", path: ["customStatus"], message: "仅自定义状态可填写说明" });
});
export const officeLayoutSchema = z.object({
  expectedVersion: z.number().int().positive(),
  departments: z.array(z.object({ departmentId: id, groupingMode: z.enum(["project", "department"]) }).strict()).max(500).default([]),
  seats: z.array(z.object({ groupId: id, memberId: id, x: z.number().int().min(0).max(31), y: z.number().int().min(0).max(127) }).strict()).max(5000).default([]),
}).strict();
export class OfficeError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); this.name = "OfficeError"; }
}
