import { describe, expect, it } from "vitest";
import { analysisProfileRegistry } from "@/workbench/analysis-profiles";
import { validateProjectDocument } from "@/workbench/document-policy";
import { getCurrentUser, loadTeamMembers, suggestOwner } from "@/workbench/team";

describe("workbench contracts", () => {
  it("uses the configured investor name on the workbench", () => {
    const members = loadTeamMembers("/tmp/vc-hunter-missing-team-config.json");

    expect(getCurrentUser(members).name).toBe("示例经理");
  });

  it("publishes six stable analysis profiles and validates advanced skills", () => {
    expect(analysisProfileRegistry.list().map((profile) => profile.label)).toEqual([
      "综合尽调", "技术壁垒", "市场与商业化", "团队与组织", "竞争格局", "风险复核",
    ]);
    expect(analysisProfileRegistry.resolve("technology-moat", ["analyze-technology@1.0.0"]).skillRefs)
      .toContain("analyze-technology@1.0.0");
    expect(() => analysisProfileRegistry.resolve("technology-moat", ["invented-skill@9.9.9"]))
      .toThrow("不存在");
  });

  it("suggests an owner deterministically from track, subtrack, and workload", () => {
    const members = [
      { id: "u-a", name: "林川", role: "投资经理", tracks: ["半导体"], subtracks: ["设备"], currentLoad: 4 },
      { id: "u-b", name: "周宁", role: "投资经理", tracks: ["半导体"], subtracks: ["先进封装"], currentLoad: 1 },
      { id: "u-c", name: "陈默", role: "投资经理", tracks: ["AI"], subtracks: ["基础模型"], currentLoad: 0 },
    ] as const;
    expect(suggestOwner(members, { track: "半导体", subtrack: "先进封装" })?.id).toBe("u-b");
  });

  it("validates extension, MIME, size, and magic bytes together", () => {
    expect(validateProjectDocument({
      name: "memo.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("%PDF-1.7\nexample"),
    }).kind).toBe("pdf");
    expect(() => validateProjectDocument({
      name: "memo.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("not-a-pdf"),
    })).toThrow("文件头");
    expect(() => validateProjectDocument({
      name: "deck.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      bytes: Buffer.from("PK"),
    })).toThrow("仅支持");
  });
});
