import { describe, expect, it } from "vitest";
import {
  createDefaultPrototypeState,
  parsePrototypeState,
  prototypeReducer,
  PROTOTYPE_STORAGE_KEY,
} from "@/prototype/store-core";

describe("prototype store", () => {
  it("uses a versioned storage key and restores valid state", () => {
    const state = createDefaultPrototypeState();

    expect(PROTOTYPE_STORAGE_KEY).toBe("vc-hunter:prototype:v1");
    expect(parsePrototypeState(JSON.stringify(state))).toEqual(state);
  });

  it("recovers from corrupt and incompatible persisted data", () => {
    expect(parsePrototypeState("broken json")).toEqual(createDefaultPrototypeState());
    expect(parsePrototypeState(JSON.stringify({ version: 0 }))).toEqual(createDefaultPrototypeState());
  });

  it("migrates valid older state with current participants and response defaults", () => {
    const older = createDefaultPrototypeState();
    older.workItems = older.workItems.map((item) => ({ ...item, response: undefined }));
    older.meetings = older.meetings.map((meeting) => meeting.id === "meeting-002" ? { ...meeting, attendees: ["林法务", "赵婧"], response: undefined } : { ...meeting, response: undefined });

    const migrated = parsePrototypeState(JSON.stringify(older));

    expect(migrated.workItems.find((item) => item.id === "work-dd-robotics")?.response).toBe("pending");
    expect(migrated.meetings.find((item) => item.id === "meeting-002")?.response).toBe("pending");
    expect(migrated.meetings.find((item) => item.id === "meeting-002")?.attendees).toContain("示例经理");
  });

  it("does not carry a demo meeting response into a new Shanghai day", () => {
    const older = createDefaultPrototypeState();
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    older.meetings = older.meetings.map((meeting) => meeting.id === "meeting-001"
      ? { ...meeting, startsAt: yesterday, response: "accepted" as const }
      : meeting);

    const migrated = parsePrototypeState(JSON.stringify(older));

    expect(migrated.meetings.find((item) => item.id === "meeting-001")?.response).toBe("pending");
  });

  it("updates approvals immutably and records an audit step", () => {
    const before = createDefaultPrototypeState();
    const request = before.approvals[0];
    const after = prototypeReducer(before, {
      type: "approval.transition",
      approvalId: request.id,
      decision: "approved",
      actor: "顾明远",
      note: "同意进入下一节点",
    });

    expect(after).not.toBe(before);
    expect(after.approvals).not.toBe(before.approvals);
    expect(before.approvals[0]?.status).toBe("pending");
    expect(after.approvals[0]?.status).toBe("approved");
    expect(after.approvals[0]?.trail.at(-1)).toMatchObject({ actor: "顾明远", action: "approved" });
  });

  it("keeps state unchanged when an action targets a missing record", () => {
    const before = createDefaultPrototypeState();
    const after = prototypeReducer(before, {
      type: "work.complete",
      workItemId: "missing",
    });

    expect(after).toBe(before);
  });

  it("records task and meeting responses immutably", () => {
    const before = createDefaultPrototypeState();
    const task = prototypeReducer(before, { type: "work.respond", workItemId: "work-dd-robotics", response: "accepted" });
    const meeting = prototypeReducer(task, { type: "meeting.respond", meetingId: "meeting-001", response: "change_requested" });

    expect(task).not.toBe(before);
    expect(task.workItems.find((item) => item.id === "work-dd-robotics")?.response).toBe("accepted");
    expect(meeting).not.toBe(task);
    expect(meeting.meetings.find((item) => item.id === "meeting-001")?.response).toBe("change_requested");
  });

  it("resets persona and fixtures to the baseline demo state", () => {
    const modified = prototypeReducer(createDefaultPrototypeState(), {
      type: "persona.select",
      persona: "finance",
    });
    const reset = prototypeReducer(modified, { type: "prototype.reset" });

    expect(reset.persona).toBe("investment_manager");
    expect(reset).toEqual(createDefaultPrototypeState());
  });

  it("completes finance and legal demo records immutably", () => {
    const before = createDefaultPrototypeState();
    const paid = prototypeReducer(before, { type: "finance.transition", financeId: "finance-002", status: "paid" });
    const returned = prototypeReducer(paid, { type: "contract.transition", contractId: "contract-001", status: "returned" });

    expect(paid).not.toBe(before);
    expect(paid.financeRecords.find((record) => record.id === "finance-002")?.status).toBe("paid");
    expect(returned.contracts).not.toBe(paid.contracts);
    expect(returned.contracts.find((contract) => contract.id === "contract-001")?.status).toBe("returned");
  });
});
