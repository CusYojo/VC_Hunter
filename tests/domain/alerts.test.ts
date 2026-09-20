import { describe, expect, it } from "vitest";
import { evaluateTalentAlert } from "@/domain/alerts";

describe("talent alert gating", () => {
  it("does not raise a high alert from one social-profile change", () => {
    const result = evaluateTalentAlert({
      eventType: "public_profile_changed",
      sources: [{ authority: "C", independentGroup: "social-profile", explicitStatement: false }],
    });

    expect(result.severity).toBe("review");
    expect(result.reason).toMatch(/待交叉验证/);
  });

  it("raises a high alert when two independent sources confirm a startup", () => {
    const result = evaluateTalentAlert({
      eventType: "started_company",
      sources: [
        { authority: "A", independentGroup: "registry", explicitStatement: false },
        { authority: "B", independentGroup: "person-announcement", explicitStatement: true },
      ],
    });

    expect(result.severity).toBe("high");
  });

  it("uses medium severity for one explicit professional statement", () => {
    const result = evaluateTalentAlert({ eventType: "left_company", sources: [{ authority: "B", independentGroup: "person-post", explicitStatement: true }] });
    expect(result.severity).toBe("medium");
  });
});
