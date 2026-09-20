import { describe, expect, it } from "vitest";
import {
  computeFollowOnRate,
  computeInvestorPerformance,
  computeTrackExposure,
  exitedCompanyIdsFor,
  latestRound,
} from "@/domain/investor-analysis";

const companyTrack = new Map([
  ["c1", "半导体" as const],
  ["c2", "半导体" as const],
  ["c3", "AI" as const],
]);

describe("investor performance analysis", () => {
  it("computes follow-on rate per company, not per round", () => {
    // 投资人参与 c1 两轮（A + B），c2 一轮，c3 零轮
    const participations = [
      { investorId: "i1", companyId: "c1", round: "a" as const, announcedAt: "2025-01-01" },
      { investorId: "i1", companyId: "c1", round: "b" as const, announcedAt: "2026-01-01" },
      { investorId: "i1", companyId: "c2", round: "a" as const, announcedAt: "2025-06-01" },
    ];

    const { followOnRate, followOnCount } = computeFollowOnRate(participations);

    // 2 家公司中 1 家跟投
    expect(followOnCount).toBe(1);
    expect(followOnRate).toBeCloseTo(0.5);
  });

  it("returns null follow-on rate when there are no participations", () => {
    const { followOnRate, followOnCount } = computeFollowOnRate([]);
    expect(followOnRate).toBeNull();
    expect(followOnCount).toBe(0);
  });

  it("counts exits only for companies the investor actually participated in", () => {
    const participations = [
      { investorId: "i1", companyId: "c1", round: "a" as const, announcedAt: "2025-01-01" },
      { investorId: "i1", companyId: "c3", round: "a" as const, announcedAt: "2025-02-01" },
    ];
    const acquiredTargets = ["c1", "c2"]; // c2 被并购但投资人未参与
    const exited = exitedCompanyIdsFor(acquiredTargets, participations.map((p) => p.companyId));

    const performance = computeInvestorPerformance(participations, companyTrack, exited);

    expect(performance.exitCount).toBe(1);
    expect(performance.participatedCompanies).toBe(2);
  });

  it("deduplicates track exposure per company", () => {
    const participations = [
      { investorId: "i1", companyId: "c1", round: "a" as const, announcedAt: "2025-01-01" },
      { investorId: "i1", companyId: "c1", round: "b" as const, announcedAt: "2026-01-01" },
      { investorId: "i1", companyId: "c3", round: "a" as const, announcedAt: "2025-03-01" },
    ];

    const exposure = computeTrackExposure(participations, companyTrack);

    expect(exposure).toEqual({ 半导体: 1, AI: 1 });
  });

  it("returns the latest round by stage order", () => {
    const participations = [
      { investorId: "i1", companyId: "c1", round: "angel" as const, announcedAt: "2024-01-01" },
      { investorId: "i1", companyId: "c1", round: "b" as const, announcedAt: "2026-01-01" },
      { investorId: "i1", companyId: "c1", round: "a" as const, announcedAt: "2025-01-01" },
    ];

    expect(latestRound(participations)).toBe("b");
    expect(latestRound([])).toBeNull();
  });
});
