import { describe, expect, it } from "vitest";
import { nextIntelligencePlanRun, nextWeekdayDigestRun } from "@/intelligence/scheduling";
import { createLicensedConnector, FixtureDiscoveryConnector, type DiscoveryConnectorRequest } from "@/intelligence/connectors";

describe("intelligence operations", () => {
  it("calculates the agreed Asia/Shanghai plan cadence", () => {
    expect(nextIntelligencePlanRun({ frequency: "daily", time: "05:30", weekdaysOnly: false }, "2026-09-14T20:00:00.000Z")).toBe("2026-09-14T21:30:00.000Z");
    expect(nextIntelligencePlanRun({ frequency: "daily", time: "05:30", weekdaysOnly: false }, "2026-09-14T22:00:00.000Z")).toBe("2026-09-15T21:30:00.000Z");
    expect(nextIntelligencePlanRun({ frequency: "every_two_days", time: "06:00", weekdaysOnly: false }, "2026-09-14T23:00:00.000Z", "2026-09-13T22:00:00.000Z")).toBe("2026-09-15T22:00:00.000Z");
    expect(nextIntelligencePlanRun({ frequency: "weekly", time: "05:00", weekdaysOnly: false, weekday: 0 }, "2026-09-14T01:00:00.000Z")).toBe("2026-09-19T21:00:00.000Z");
    expect(nextWeekdayDigestRun("2026-09-17T01:00:00.000Z")).toBe("2026-09-18T00:30:00.000Z");
    expect(nextWeekdayDigestRun("2026-09-18T02:00:00.000Z")).toBe("2026-09-21T00:30:00.000Z");
  });

  it("keeps QCC, Tianyancha and hiring connectors disabled until licensed", async () => {
    const request: DiscoveryConnectorRequest = { queryFamily: "registry-ai", tracks: ["AI"], subtracks: [], cities: ["深圳"], dateFrom: "2026-09-12", dateTo: "2026-09-14", limit: 20 };
    for (const connector of [createLicensedConnector("qcc", null), createLicensedConnector("tianyancha", null), createLicensedConnector("boss", null)]) {
      expect(connector.enabled).toBe(false);
      await expect(connector.collect(request)).rejects.toThrow("尚未配置正式授权");
    }
    const fixture = new FixtureDiscoveryConnector("qcc", [{ externalId: "qcc-1", name: "测试企业", occurredAt: "2026-09-13", url: "https://example.com/company", excerpt: "依法取得的模拟数据。" }]);
    await expect(fixture.collect(request)).resolves.toHaveLength(1);
  });
});
