import type { InvestorDetail } from "@/repositories/investor-directory";

export const investorProfile: InvestorDetail = {
  id: "inv-test", name: "测试创投", englishName: null, aliases: [], type: "vc", institutionType: "financial_vc",
  headquarters: "北京", focusTracks: ["AI"], subtracks: [], stageFocus: [], investmentStyle: null, thesis: null,
  keyPeople: [], portfolioSample: [], fundSize: { amount: null, currency: null, text: "未统一公开" },
  sourceRefs: ["https://example.com/about/", "javascript:alert(1)"], status: "verified", priority: 1, rank: 1,
  verification: { verifiedAt: null, verifiedBy: null, notes: "仅沿用源表核验标记" }, notes: "机构备注",
  portfolioCount: 0, trackPerformance: {}, version: 4, createdAt: "2026-09-01", updatedAt: null,
  investmentHistory: [], extra: { "原始列:最近投资项目（2025-2026公开示例）": "甲公司（2026，公开示例）", "原始列:核验状态": "重点已核验", sourceFile: "机构池.xlsx" },
};
