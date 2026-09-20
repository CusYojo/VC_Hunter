import { describe, expect, it } from "vitest";
import { classifyDiscoveryCandidate } from "@/domain/discovery-candidate";

describe("discovery candidate classification", () => {
  it("selects the track with the most deterministic keyword evidence", () => {
    expect(classifyDiscoveryCandidate("Chiplet 先进封装芯片完成客户验证")).toEqual({
      track: "半导体",
      keywords: ["芯片", "chiplet", "封装"],
    });
  });

  it("leaves unmatched items unclassified for human resolution", () => {
    expect(classifyDiscoveryCandidate("公司发布年度治理报告")).toEqual({ track: null, keywords: [] });
  });
});
