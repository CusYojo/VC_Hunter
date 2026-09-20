import { describe, expect, it } from "vitest";
import { calculateEvidenceQuality, createAssertion } from "@/domain/evidence";

describe("evidence assertions", () => {
  it("requires a null reason when a private-company metric is unknown", () => {
    expect(() =>
      createAssertion({
        subjectId: "project-1",
        predicate: "revenue_2026",
        valueStatus: "unknown",
        sourceIds: [],
      }),
    ).toThrow(/null reason/i);
  });

  it("keeps estimates separate from disclosed facts", () => {
    const assertion = createAssertion({
      subjectId: "project-1",
      predicate: "valuation",
      valueStatus: "estimated",
      value: { low: 800_000_000, base: 1_000_000_000, high: 1_400_000_000 },
      sourceIds: ["evidence-1"],
      method: "comparable_multiples",
    });

    expect(assertion.estimated).toBe(true);
    expect(assertion.valueStatus).toBe("estimated");
  });

  it("scores primary independent evidence above reposts", () => {
    const score = calculateEvidenceQuality([
      { authority: "A", primary: true, independentGroup: "company" },
      { authority: "A", primary: true, independentGroup: "regulator" },
      { authority: "D", primary: false, independentGroup: "repost-cluster-1" },
    ]);

    expect(score).toBeGreaterThanOrEqual(0.9);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("rejects unavailable values carrying fabricated data", () => {
    expect(() => createAssertion({ subjectId: "p1", predicate: "revenue", valueStatus: "not_disclosed", value: 0, nullReason: "未披露", sourceIds: ["e1"] })).toThrow(/cannot carry/i);
  });

  it("rejects estimates without a method and returns zero for no evidence", () => {
    expect(() => createAssertion({ subjectId: "p1", predicate: "valuation", valueStatus: "estimated", value: { low: 1, high: 2 }, sourceIds: ["e1"] })).toThrow(/method/i);
    expect(calculateEvidenceQuality([])).toBe(0);
  });
});
