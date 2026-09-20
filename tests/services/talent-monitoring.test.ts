import { describe, expect, it } from "vitest";
import { evaluateTalentAlert } from "@/domain/alerts";
import { registerTalentEvent } from "@/services/talent-monitoring";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";

describe("talent monitoring", () => {
  it("keeps single public-profile changes at review severity", () => {
    const decision = evaluateTalentAlert({
      eventType: "public_profile_changed",
      sources: [{ authority: "C", independentGroup: "social-profile", explicitStatement: false }],
    });
    expect(decision.severity).toBe("review");
  });

  it("treats paper/patent signals as review-level auxiliary evidence", () => {
    const decision = evaluateTalentAlert({
      eventType: "paper_published",
      sources: [{ authority: "B", independentGroup: "paper-arxiv", explicitStatement: false }],
    });
    expect(decision.severity).toBe("review");
  });

  it("raises high severity for a startup confirmed by two independent sources", () => {
    const decision = evaluateTalentAlert({
      eventType: "started_company",
      sources: [
        { authority: "A", independentGroup: "registry", explicitStatement: false },
        { authority: "B", independentGroup: "person-post", explicitStatement: true },
      ],
    });
    expect(decision.severity).toBe("high");
  });

  it("registers talent events idempotently with a dedupe key", () => {
    const database: DatabaseSync = createDatabase(":memory:");
    initializeDatabase(database);
    seedDemoData(database);

    const input = {
      personId: "person-weiyuan",
      eventType: "left_company" as const,
      occurredAt: "2026-08-30",
      summary: "演示：离开现职，去向待确认。",
      confidence: 0.8,
      sources: [{ authority: "B" as const, independentGroup: "person-post", explicitStatement: true }],
    };

    const first = registerTalentEvent(database, input);
    const second = registerTalentEvent(database, input);

    expect(first.id).toBe(second.id);
    expect(first.alertSeverity).toBe("medium");
    const count = database.prepare("SELECT count(*) AS count FROM person_events").get() as { count: number };
    expect(count.count).toBe(4); // 3 seeded + 1 new (deduped)

    database.close();
  });

  it("rejects invalid confidence values", () => {
    const database: DatabaseSync = createDatabase(":memory:");
    initializeDatabase(database);
    expect(() =>
      registerTalentEvent(database, {
        personId: "p",
        eventType: "left_company",
        occurredAt: "2026-08-30",
        summary: "x",
        confidence: 1.5,
        sources: [],
      }),
    ).toThrow(/confidence/i);
    database.close();
  });
});
