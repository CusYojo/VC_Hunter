import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import { SqliteIntelligenceRepository } from "@/repositories/intelligence";

describe("intelligence repository", () => {
  let database: DatabaseSync;
  let repository: SqliteIntelligenceRepository;

  beforeEach(() => {
    database = createDatabase(":memory:");
    initializeDatabase(database);
    seedDemoData(database);
    repository = new SqliteIntelligenceRepository(database);
  });

  afterEach(() => database.close());

  it("lists investors with track performance and portfolio counts", () => {
    const investors = repository.listInvestors();
    expect(investors).toHaveLength(4);
    const chenxing = investors.find((investor) => investor.id === "investor-chenxing");
    expect(chenxing?.portfolioCount).toBeGreaterThan(0);
    expect(chenxing?.trackPerformance).toHaveProperty("半导体");
  });

  it("lists investment events linked to companies", () => {
    const events = repository.listInvestmentEvents();
    expect(events.length).toBeGreaterThan(0);
    const qiongxin = events.find((event) => event.id === "inv-qiongxin-b");
    expect(qiongxin?.companyName).toContain("穹芯");
    expect(qiongxin?.leadInvestors).toContain("investor-chenxing");
  });

  it("lists M&A events with target company names", () => {
    const maEvents = repository.listMaEvents();
    expect(maEvents.length).toBeGreaterThan(0);
    expect(maEvents.every((event) => event.targetName.length > 0)).toBe(true);
  });

  it("lists people with company roles and career event counts", () => {
    const people = repository.listPeople();
    expect(people.length).toBeGreaterThan(0);
    const weiyuan = people.find((person) => person.id === "person-weiyuan");
    expect(weiyuan?.companyRoles).toHaveLength(1);
    expect(weiyuan?.careerEvents24m).toBeGreaterThan(0);
    expect(repository.findPerson("person-weiyuan")?.aliases.length).toBeGreaterThan(0);
  });

  it("lists person events with alert severity", () => {
    const events = repository.listPersonEvents();
    expect(events.some((event) => event.alertSeverity === "high")).toBe(true);
  });

  it("lists topic knowledge cards ordered by hotness", () => {
    const cards = repository.listTopicKnowledgeCards();
    expect(cards.length).toBeGreaterThan(0);
    expect(cards[0].hotness).toBeGreaterThanOrEqual(cards[cards.length - 1].hotness);
  });

  it("returns undefined for missing people", () => {
    expect(repository.findPerson("missing")).toBeUndefined();
  });
});
