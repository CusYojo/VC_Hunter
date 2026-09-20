import { defaultPrototypeState } from "@/prototype/fixtures";
import { demoPersonaSchema, prototypeStateSchema, type DemoPersona, type PrototypeState } from "@/prototype/contracts";

export const PROTOTYPE_STORAGE_KEY = "vc-hunter:prototype:v1";

export type PrototypeAction =
  | { type: "persona.select"; persona: DemoPersona }
  | { type: "work.complete"; workItemId: string }
  | { type: "work.respond"; workItemId: string; response: "accepted" | "declined" | "change_requested" }
  | { type: "meeting.respond"; meetingId: string; response: "accepted" | "declined" | "change_requested" }
  | { type: "approval.transition"; approvalId: string; decision: "approved" | "returned"; actor: string; note: string }
  | { type: "finance.transition"; financeId: string; status: "paid" }
  | { type: "contract.transition"; contractId: string; status: "returned" | "effective" }
  | { type: "workflow.toggle"; workflowId: string }
  | { type: "prototype.reset" };

export function createDefaultPrototypeState(): PrototypeState {
  const state = structuredClone(defaultPrototypeState);
  const today = dateKeyInShanghai(new Date());
  return {
    ...state,
    meetings: state.meetings.map((meeting) => ({
      ...meeting,
      startsAt: moveToShanghaiDate(meeting.startsAt, today),
    })),
  };
}

export function parsePrototypeState(serialized: string | null): PrototypeState {
  if (!serialized) return createDefaultPrototypeState();
  try {
    const parsed = prototypeStateSchema.safeParse(JSON.parse(serialized));
    return parsed.success ? migratePrototypeState(parsed.data) : createDefaultPrototypeState();
  } catch {
    return createDefaultPrototypeState();
  }
}

function migratePrototypeState(persisted: PrototypeState): PrototypeState {
  const defaults = createDefaultPrototypeState();
  const workById = new Map(persisted.workItems.map((item) => [item.id, item]));
  const meetingById = new Map(persisted.meetings.map((meeting) => [meeting.id, meeting]));
  const knownWorkIds = new Set(defaults.workItems.map((item) => item.id));
  const knownMeetingIds = new Set(defaults.meetings.map((meeting) => meeting.id));
  return {
    ...persisted,
    workItems: [
      ...defaults.workItems.map((baseline) => {
        const saved = workById.get(baseline.id);
        return saved ? { ...baseline, ...saved, response: saved.response ?? baseline.response } : baseline;
      }),
      ...persisted.workItems.filter((item) => !knownWorkIds.has(item.id)),
    ],
    meetings: [
      ...defaults.meetings.map((baseline) => {
        const saved = meetingById.get(baseline.id);
        const isSameDay = saved && dateKeyInShanghai(new Date(saved.startsAt)) === dateKeyInShanghai(new Date(baseline.startsAt));
        return saved ? {
          ...baseline,
          ...saved,
          startsAt: baseline.startsAt,
          attendees: [...new Set([...baseline.attendees, ...saved.attendees])],
          response: isSameDay ? saved.response ?? baseline.response : baseline.response,
        } : baseline;
      }),
      ...persisted.meetings.filter((meeting) => !knownMeetingIds.has(meeting.id)),
    ],
  };
}

function dateKeyInShanghai(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Shanghai" }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function moveToShanghaiDate(value: string, date: string): string {
  const clockParts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) => clockParts.find((part) => part.type === type)?.value ?? "00";
  return new Date(`${date}T${get("hour")}:${get("minute")}:${get("second")}+08:00`).toISOString();
}

export function prototypeReducer(state: PrototypeState, action: PrototypeAction): PrototypeState {
  if (action.type === "prototype.reset") return createDefaultPrototypeState();
  if (action.type === "persona.select") {
    const persona = demoPersonaSchema.parse(action.persona);
    return persona === state.persona ? state : { ...state, persona };
  }
  if (action.type === "work.complete") {
    const target = state.workItems.find((item) => item.id === action.workItemId);
    if (!target || target.status === "done") return state;
    return { ...state, workItems: state.workItems.map((item) => item.id === action.workItemId ? { ...item, status: "done" as const } : item) };
  }
  if (action.type === "work.respond") {
    const target = state.workItems.find((item) => item.id === action.workItemId);
    if (!target || target.status === "done" || target.response === action.response) return state;
    return { ...state, workItems: state.workItems.map((item) => item.id === action.workItemId ? { ...item, response: action.response } : item) };
  }
  if (action.type === "meeting.respond") {
    const target = state.meetings.find((meeting) => meeting.id === action.meetingId);
    if (!target || target.response === action.response) return state;
    return { ...state, meetings: state.meetings.map((meeting) => meeting.id === action.meetingId ? { ...meeting, response: action.response } : meeting) };
  }
  if (action.type === "workflow.toggle") {
    if (!state.workflows.some((workflow) => workflow.id === action.workflowId)) return state;
    return { ...state, workflows: state.workflows.map((workflow) => workflow.id === action.workflowId ? { ...workflow, enabled: !workflow.enabled } : workflow) };
  }
  if (action.type === "finance.transition") {
    const target = state.financeRecords.find((record) => record.id === action.financeId);
    if (!target || target.status === action.status) return state;
    return { ...state, financeRecords: state.financeRecords.map((record) => record.id === action.financeId ? { ...record, status: action.status } : record) };
  }
  if (action.type === "contract.transition") {
    const target = state.contracts.find((contract) => contract.id === action.contractId);
    if (!target || target.status === action.status) return state;
    return { ...state, contracts: state.contracts.map((contract) => contract.id === action.contractId ? { ...contract, status: action.status } : contract) };
  }
  if (action.type !== "approval.transition") return state;
  const target = state.approvals.find((approval) => approval.id === action.approvalId);
  if (!target || target.status !== "pending") return state;
  const nextTrail = {
    id: `trail-${action.approvalId}-${target.trail.length + 1}`,
    actor: action.actor,
    action: action.decision,
    note: action.note,
    at: new Date().toISOString(),
  };
  return {
    ...state,
    approvals: state.approvals.map((approval) => approval.id === action.approvalId
      ? { ...approval, status: action.decision, trail: [...approval.trail, nextTrail] }
      : approval),
  };
}
