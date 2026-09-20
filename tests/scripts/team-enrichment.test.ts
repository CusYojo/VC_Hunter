import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { applyTeamEnrichments, type TeamEnrichment } from "../../scripts/team-enrichment-lib";

const databases: DatabaseSync[] = [];

function createDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec(`
    CREATE TABLE intelligence_candidates (
      id TEXT PRIMARY KEY,
      subject_name TEXT NOT NULL,
      missing_fields_json TEXT NOT NULL DEFAULT '[]',
      review_version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE intelligence_candidate_sources (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      published_at TEXT,
      observed_at TEXT NOT NULL,
      excerpt TEXT NOT NULL,
      authority TEXT NOT NULL,
      access_class TEXT NOT NULL,
      collection_method TEXT NOT NULL CHECK(collection_method IN ('web_search','rss','api','codex','manual_upload','legacy')),
      allow_external_model INTEGER NOT NULL,
      content_hash TEXT NOT NULL
    );
    CREATE UNIQUE INDEX candidate_source_ref_unique
      ON intelligence_candidate_sources(candidate_id, source_ref);
    CREATE TABLE intelligence_candidate_assertions (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      field_key TEXT NOT NULL,
      label TEXT NOT NULL,
      value_status TEXT NOT NULL,
      epistemic_type TEXT NOT NULL,
      value_json TEXT,
      unit TEXT,
      confidence REAL NOT NULL,
      evidence_refs_json TEXT NOT NULL
    );
  `);
  return database;
}

function enrichment(overrides: Partial<TeamEnrichment> = {}): TeamEnrichment {
  return {
    candidateId: "candidate-1",
    subjectName: "测试公司",
    value: "创始人张三具备十年产业经验。",
    confidence: 0.9,
    evidence: [{
      ref: "team-official",
      title: "测试公司团队介绍",
      url: "https://example.com/team",
      publishedAt: "2026-09-16",
      excerpt: "创始人张三具备十年产业经验。",
      authority: "A",
      accessClass: "public",
      collectionMethod: "web_search",
    }],
    ...overrides,
  };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("applyTeamEnrichments", () => {
  it("replaces an unknown team assertion, records evidence, and clears the missing field", () => {
    const database = createDatabase();
    database.prepare("INSERT INTO intelligence_candidates VALUES(?,?,?,?,?)")
      .run("candidate-1", "测试公司", JSON.stringify(["coreTeam", "revenue"]), 1, "2026-09-17T00:00:00.000Z");
    database.prepare("INSERT INTO intelligence_candidate_assertions VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run("unknown-1", "candidate-1", "coreTeam", "核心团队", "unknown", "fact", null, null, 0, "[]");

    const result = applyTeamEnrichments(database, [enrichment()], "2026-09-17T08:00:00.000Z");

    expect(result).toEqual({ applied: 1, skipped: 0 });
    const assertion = database.prepare("SELECT * FROM intelligence_candidate_assertions WHERE candidate_id=? AND field_key='coreTeam'").get("candidate-1") as Record<string, unknown>;
    expect(assertion.value_status).toBe("known");
    expect(JSON.parse(String(assertion.value_json))).toBe("创始人张三具备十年产业经验。");
    expect(JSON.parse(String(assertion.evidence_refs_json))).toEqual(["team-official"]);
    expect(database.prepare("SELECT COUNT(*) AS count FROM intelligence_candidate_sources").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT review_version,missing_fields_json FROM intelligence_candidates WHERE id='candidate-1'").get())
      .toEqual({ review_version: 2, missing_fields_json: JSON.stringify(["revenue"]) });
  });

  it("is idempotent when the same sourced value is applied twice", () => {
    const database = createDatabase();
    database.prepare("INSERT INTO intelligence_candidates VALUES(?,?,?,?,?)")
      .run("candidate-1", "测试公司", "[]", 1, "2026-09-17T00:00:00.000Z");

    expect(applyTeamEnrichments(database, [enrichment()], "2026-09-17T08:00:00.000Z")).toEqual({ applied: 1, skipped: 0 });
    expect(applyTeamEnrichments(database, [enrichment()], "2026-09-17T09:00:00.000Z")).toEqual({ applied: 0, skipped: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM intelligence_candidate_sources").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM intelligence_candidate_assertions").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT review_version FROM intelligence_candidates WHERE id='candidate-1'").get()).toEqual({ review_version: 2 });
  });

  it("refuses to overwrite a different known team value", () => {
    const database = createDatabase();
    database.prepare("INSERT INTO intelligence_candidates VALUES(?,?,?,?,?)")
      .run("candidate-1", "测试公司", "[]", 1, "2026-09-17T00:00:00.000Z");
    database.prepare("INSERT INTO intelligence_candidate_assertions VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run("known-1", "candidate-1", "coreTeam", "核心团队", "known", "fact", JSON.stringify("已有团队信息"), null, 0.8, "[]");

    expect(() => applyTeamEnrichments(database, [enrichment()], "2026-09-17T08:00:00.000Z"))
      .toThrow("已有不同的核心团队信息");
  });

  it("rolls back the full batch when an item targets the wrong company", () => {
    const database = createDatabase();
    database.prepare("INSERT INTO intelligence_candidates VALUES(?,?,?,?,?)")
      .run("candidate-1", "测试公司", "[]", 1, "2026-09-17T00:00:00.000Z");

    expect(() => applyTeamEnrichments(database, [
      enrichment(),
      enrichment({ candidateId: "candidate-1", subjectName: "另一家公司", value: "另一团队" }),
    ], "2026-09-17T08:00:00.000Z")).toThrow("候选项目名称不匹配");
    expect(database.prepare("SELECT COUNT(*) AS count FROM intelligence_candidate_sources").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM intelligence_candidate_assertions").get()).toEqual({ count: 0 });
  });

  it.each([
    ["missing identity", { value: " " }, "团队补充信息不完整"],
    ["invalid confidence", { confidence: 1.1 }, "置信度必须在 0 到 1 之间"],
    ["missing evidence", { evidence: [] }, "缺少团队信息来源"],
    ["duplicate evidence refs", {
      evidence: [enrichment().evidence[0], enrichment().evidence[0]],
    }, "来源编号重复"],
  ])("rejects %s", (_label, overrides, expectedMessage) => {
    const database = createDatabase();
    database.prepare("INSERT INTO intelligence_candidates VALUES(?,?,?,?,?)")
      .run("candidate-1", "测试公司", "[]", 1, "2026-09-17T00:00:00.000Z");

    expect(() => applyTeamEnrichments(database, [enrichment(overrides)], "2026-09-17T08:00:00.000Z"))
      .toThrow(expectedMessage);
  });

  it("rejects a missing candidate and a conflicting source reference", () => {
    const missingDatabase = createDatabase();
    expect(() => applyTeamEnrichments(missingDatabase, [enrichment()], "2026-09-17T08:00:00.000Z"))
      .toThrow("找不到候选项目");

    const conflictDatabase = createDatabase();
    conflictDatabase.prepare("INSERT INTO intelligence_candidates VALUES(?,?,?,?,?)")
      .run("candidate-1", "测试公司", "[]", 1, "2026-09-17T00:00:00.000Z");
    conflictDatabase.prepare("INSERT INTO intelligence_candidate_sources VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run("source-1", "candidate-1", "team-official", "旧来源", "https://example.com/old", null,
        "2026-09-16T00:00:00.000Z", "旧摘要", "A", "public", "web_search", 0, "hash");

    expect(() => applyTeamEnrichments(conflictDatabase, [enrichment()], "2026-09-17T08:00:00.000Z"))
      .toThrow("来源编号与已有链接冲突");
  });

  it("reuses an existing source, removes duplicate unknown assertions, and validates missing fields", () => {
    const database = createDatabase();
    database.prepare("INSERT INTO intelligence_candidates VALUES(?,?,?,?,?)")
      .run("candidate-1", "测试公司", JSON.stringify(["coreTeam"]), 1, "2026-09-17T00:00:00.000Z");
    database.prepare("INSERT INTO intelligence_candidate_sources VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run("source-1", "candidate-1", "team-official", "测试公司团队介绍", "https://example.com/team", null,
        "2026-09-16T00:00:00.000Z", "摘要", "A", "public", "web_search", 0, "hash");
    for (const id of ["unknown-1", "unknown-2"]) {
      database.prepare("INSERT INTO intelligence_candidate_assertions VALUES(?,?,?,?,?,?,?,?,?,?)")
        .run(id, "candidate-1", "coreTeam", "核心团队", "unknown", "fact", null, null, 0, "[]");
    }

    expect(applyTeamEnrichments(database, [enrichment()], "2026-09-17T08:00:00.000Z"))
      .toEqual({ applied: 1, skipped: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM intelligence_candidate_sources").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM intelligence_candidate_assertions").get()).toEqual({ count: 1 });

    const invalidDatabase = createDatabase();
    invalidDatabase.prepare("INSERT INTO intelligence_candidates VALUES(?,?,?,?,?)")
      .run("candidate-1", "测试公司", JSON.stringify(["coreTeam", 3]), 1, "2026-09-17T00:00:00.000Z");
    expect(() => applyTeamEnrichments(invalidDatabase, [enrichment()], "2026-09-17T08:00:00.000Z"))
      .toThrow("候选项目字段格式无效");
  });
});
