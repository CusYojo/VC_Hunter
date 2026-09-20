import { it, expect } from "vitest";
import { createDatabase, initializeDatabase } from "@/db/client";
import { SqliteInvestorDirectoryRepository } from "@/repositories/investor-directory";
import { prepareInvestorImport } from "@/services/investor-import";

it("imports institutions only, is repeatable and preserves maintained values", () => {
  const database = createDatabase(":memory:");
  try {
    initializeDatabase(database);
    const repository = new SqliteInvestorDirectoryRepository(database);
    const existing = repository.create({ name: "已有机构", institutionType: "financial_vc", focusTracks: ["AI"], notes: "人工维护" }, "test");
    const { entries } = prepareInvestorImport([
      { 机构名: "已有机构", 备注: "源备注", 来源URL: "https://example.com/a/" },
      { 机构名: "新机构", 活跃优先级: "S", 核验状态: "重点已核验", "公开管理规模/体系规模": "未统一公开", "最近投资项目（2025-2026公开示例）": "甲公司（2026）" },
    ]);
    expect(repository.upsertMany(entries, "test")).toEqual({ inserted: 1, updated: 1, skipped: 0 });
    expect(repository.upsertMany(entries, "test")).toEqual({ inserted: 0, updated: 0, skipped: 2 });
    expect(repository.findById(existing.id)).toMatchObject({ notes: "人工维护", extra: { "原始列:备注": "源备注" } });
    expect(repository.findByName("新机构")).toMatchObject({ priority: 1, status: "verified", fundSize: { text: "未统一公开" } });
    for (const table of ["projects", "companies", "investment_events"]) {
      expect(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count).toBe(0);
    }
  } finally { database.close(); }
});
