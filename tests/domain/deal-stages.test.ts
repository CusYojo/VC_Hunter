import { describe, expect, it } from "vitest";
import { autoAdvanceDealStage, dealStageIdForValue, deriveCurrentDealStage, projectStatusForDealStage } from "@/workbench/deal-stages";

describe("deal stage progress", () => {
  it("uses the furthest active milestone and ignores cancelled nodes", () => {
    expect(deriveCurrentDealStage([
      { stage: "ic", status: "cancelled" },
      { stage: "contact", status: "done" },
      { stage: "dd", status: "in_progress" },
    ], "initiation")).toBe("dd");
  });

  it("keeps the saved stage when there are no active milestones", () => {
    expect(deriveCurrentDealStage([{ stage: "ic", status: "cancelled" }], "contact")).toBe("contact");
  });

  it("maps workflow stages to catalog statuses and recognizes persisted labels", () => {
    expect(projectStatusForDealStage("pre_ic", "dd")).toBe("ic");
    expect(projectStatusForDealStage("dd", "pass")).toBe("dd");
    expect(projectStatusForDealStage("custom-review", "researching")).toBe("researching");
    expect(dealStageIdForValue("内决会")).toBe("pre_ic");
  });

  it("only advances automatically while manual selection can be handled separately", () => {
    expect(autoAdvanceDealStage("dd", "contact")).toBe("dd");
    expect(autoAdvanceDealStage("dd", "ic")).toBe("ic");
  });
});
