import { describe, expect, it } from "vitest";
import { normalizeInvestorRow, parseInvestorCsv, parseInvestorJson, prepareInvestorImport } from "@/services/investor-import";

const row = {
  序号: "1", 机构名: "红杉中国", 机构类型: "市场化VC/PE", 主要地区: "北京/上海",
  核心赛道: "AI、具身智能、半导体、医疗、先进制造", "公开管理规模/体系规模": "36氪口径500亿元；官网未披露统一AUM",
  "最近投资项目（2025-2026公开示例）": "张雪机车（2026-08，独家投资）；聚合聚变（2026-06）",
  "明星/代表项目": "字节跳动、美团、宇树科技", 活跃优先级: "S", 核验状态: "重点已核验",
  来源URL: "https://www.hongshan.com/about-us/", 备注: "官网：累计投资1800+企业。",
};

describe("institution import normalization", () => {
  it("maps the workbook headers and preserves scale, examples and every original column", () => {
    const result = normalizeInvestorRow(row, { sourceFile: "institutions.xlsx", sourceSheet: "300家机构总表" });
    expect(result).toMatchObject({ name: "红杉中国", headquarters: "北京/上海", priority: 1, status: "verified", rank: 1,
      institutionType: "financial_vc", focusTracks: ["AI", "具身智能", "半导体", "生物医药"],
      fundSize: { amount: null, currency: null, text: row["公开管理规模/体系规模"] },
      sourceRefs: [row.来源URL], notes: row.备注,
      verification: { verifiedAt: null, verifiedBy: null, notes: "源表核验状态：重点已核验；仅沿用源表标记，未执行独立核验。" },
    });
    for (const [header, value] of Object.entries(row)) expect(result.extra?.[`原始列:${header}`]).toBe(value);
    expect(result.extra?.sourceSheet).toBe("300家机构总表");
    expect(result.portfolioSample?.map((item) => item.company)).toEqual(["字节跳动", "美团", "宇树科技"]);
    expect(result.extra?.["原始列:核心赛道"]).toContain("先进制造");
  });

  it.each(["近期项目已核验", "方向已核验", "已核实", "verified"])("recognizes source verified status %s", (status) => {
    expect(normalizeInvestorRow({ name: "机构", status }).status).toBe("verified");
  });
  it.each(["待核验", "未核实", "未核验", "基础信息已录入", "unverified"])("does not promote %s", (status) => {
    expect(normalizeInvestorRow({ name: "机构", status }).status).toBe("seed_candidate");
  });
  it.each([["S", 1], ["A", 2], ["3", 3], ["头部", 1], ["watch", 3]])("maps priority %s", (priority, expected) => {
    expect(normalizeInvestorRow({ name: "机构", priority }).priority).toBe(expected);
  });
  it("preserves URL paths, query punctuation and multiple newline-separated sources", () => {
    const urls = ["https://example.com/a/b?q=x,y;z&next=/c", "https://example.org/path/"];
    expect(normalizeInvestorRow({ name: "机构", 来源URL: urls.join("\n") }).sourceRefs).toEqual(urls);
  });
  it("retains structured JSON and existing CSV aliases", () => {
    const input = { name: "机构", focusTracks: ["AI"], sourceRefs: ["https://example.com/a/"],
      fundSize: { amount: 100, currency: "CNY", text: "100元" }, keyPeople: [{ name: "张三", title: "合伙人" }],
      portfolioSample: [{ company: "甲公司", year: 2026 }], extra: { manual: "保留" } };
    expect(normalizeInvestorRow(parseInvestorJson(JSON.stringify([input]))[0])).toMatchObject(input);
    expect(prepareInvestorImport(parseInvestorCsv('\ufeff机构名称,备注\r\n"机构","第一行\n第二行，含逗号"\r\n')).entries[0].notes).toBe("第一行\n第二行，含逗号");
    expect(parseInvestorJson(JSON.stringify({ items: [input] }))).toHaveLength(1);
  });
  it("rejects duplicate normalized names, missing names and unexpected row counts before writing", () => {
    expect(() => prepareInvestorImport([{ name: "机构" }, { name: " 机构 " }])).toThrow(/重复/);
    expect(() => prepareInvestorImport([{ name: "机构" }, { notes: "无名称" }])).toThrow(/名称/);
    expect(() => prepareInvestorImport([{ name: "机构" }], { expectedCount: 300 })).toThrow(/300/);
  });
  it("rejects malformed JSON/CSV, conflicting aliases and invalid fields instead of silently dropping data", () => {
    expect(() => parseInvestorJson('{"unknown":[]}')).toThrow();
    expect(() => parseInvestorJson('[null]')).toThrow();
    expect(() => parseInvestorCsv('name,notes\n"unfinished')).toThrow();
    expect(() => parseInvestorCsv('name,name\n甲,乙')).toThrow();
    expect(() => parseInvestorCsv('name,notes\n甲,乙,丙')).toThrow();
    expect(() => normalizeInvestorRow({ name: "甲", 机构名: "乙" })).toThrow(/冲突/);
    expect(() => normalizeInvestorRow({ name: "甲", rank: "1oops" })).toThrow();
    expect(() => normalizeInvestorRow({ name: "甲", notes: "长".repeat(4001) })).toThrow();
  });
  it("reports unique counts and warnings without changing the source rows", () => {
    const source = Object.freeze({ name: "机构", focusTracks: "新能源", status: "基础信息已录入" });
    const result = prepareInvestorImport([source], { expectedCount: 1 });
    expect(result.entries).toHaveLength(1);
    expect(result.summary).toMatchObject({ rows: 1, uniqueInstitutions: 1, verified: 0, noTrack: 1 });
    expect(result.warnings.join(" ")).toContain("新能源");
    expect(source.focusTracks).toBe("新能源");
  });
});
