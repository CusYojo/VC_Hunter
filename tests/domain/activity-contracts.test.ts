import { describe, expect, it } from "vitest";
import { activityInputSchema } from "@/workbench/activity-contracts";

describe("activity input", () => {
  it("allows selecting every member of a team larger than thirty while retaining a bounded payload", () => {
    const participantIds = Array.from({ length: 46 }, (_, index) => `member-${index}`);
    expect(activityInputSchema.parse({ kind: "meeting", title: "全员会", participantIds }).participantIds).toEqual(participantIds);
    expect(() => activityInputSchema.parse({ kind: "meeting", title: "异常名单", participantIds: Array.from({ length: 501 }, (_, index) => `member-${index}`) })).toThrow();
  });

  it("accepts exact ISO times with minutes outside a fifteen-minute boundary", () => {
    expect(activityInputSchema.parse({ kind: "meeting", title: "特殊时间", dueAt: "2026-09-06T01:07:00.000Z", endAt: "2026-09-06T01:38:00.000Z" })).toMatchObject({ dueAt: "2026-09-06T01:07:00.000Z", endAt: "2026-09-06T01:38:00.000Z" });
  });
});
