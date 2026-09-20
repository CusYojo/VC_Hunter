import { describe, expect, it, vi } from "vitest";
import { DeepSeekModelGateway } from "@/connectors/deepseek-model-gateway";

const input = { projectName: "穹芯微电子", track: "半导体", evidence: [{ id: "evidence-1", quote: "公司宣布完成客户送测。", authority: "A" as const }] };

describe("DeepSeek model gateway", () => {
  it("requests JSON output and accepts only evidence-backed findings", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "ds-1", model: "deepseek-v4-flash", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ summary: "已进入客户验证阶段。", findings: [{ claim: "完成客户送测", evidenceIds: ["evidence-1"] }], risks: [], openQuestions: ["客户名称是什么？"] }) } }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }), { status: 200, headers: { "content-type": "application/json" } }));
    const gateway = new DeepSeekModelGateway("secret-key", fetchMock);

    const result = await gateway.generateResearchBrief(input);

    expect(result.findings[0].evidenceIds).toEqual(["evidence-1"]);
    const request = fetchMock.mock.calls[0];
    expect(request[0]).toBe("https://api.deepseek.com/chat/completions");
    expect(request[1].headers.authorization).toBe("Bearer secret-key");
    expect(JSON.parse(request[1].body)).toMatchObject({ model: "deepseek-v4-flash", response_format: { type: "json_object" }, stream: false });
    expect(request[1].body).not.toContain("secret-key");
  });

  it("fails closed without a key and rejects hallucinated evidence references", async () => {
    await expect(new DeepSeekModelGateway("").generateResearchBrief(input)).rejects.toThrow(/api key/i);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "ds-2", model: "deepseek-v4-flash", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ summary: "x", findings: [{ claim: "无来源结论", evidenceIds: ["invented"] }], risks: [], openQuestions: [] }) } }], usage: { total_tokens: 10 } }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(new DeepSeekModelGateway("key", fetchMock).generateResearchBrief(input)).rejects.toThrow(/unknown evidence/i);
  });

  it("qualifies every discovery lead with the fixed grounded schema", async () => {
    const content = { assessments: [{ leadId: "lead-1", relevant: true, companyName: "穹芯微电子", track: "半导体", investorNames: ["中科创星"], signalType: "investment", summary: "中科创星投资穹芯微电子。", confidence: 0.9 }] };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "ds-3", model: "deepseek-v4-flash", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }], usage: { total_tokens: 80 } }), { status: 200, headers: { "content-type": "application/json" } }));
    const gateway = new DeepSeekModelGateway("key", fetchMock);

    const result = await gateway.qualifyDiscoveryLeads({ query: "半导体投资", leads: [{ id: "lead-1", title: "中科创星投资穹芯微电子", url: "https://example.com/1", highlights: ["穹芯微电子完成新一轮融资。"] }] });

    expect(result).toEqual(content.assessments);
    expect(String(fetchMock.mock.calls[0][1].body)).toContain("lead-qualification-v1");
    expect(String(fetchMock.mock.calls[0][1].body)).toContain("funding|investment|ma|milestone|talent|other");
    expect(String(fetchMock.mock.calls[0][1].body)).toContain("AI|具身智能|半导体|核聚变|生物医药|商业航天|新材料");
  });

  it("normalizes a Chinese signal label into the fixed workflow enum", async () => {
    const content = { assessments: [{ leadId: "lead-1", relevant: true, companyName: "穹芯微电子", track: "芯片", investorNames: ["中科创星"], signalType: "融资", summary: "中科创星投资穹芯微电子。", confidence: 0.9 }] };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "ds-zh", model: "deepseek-v4-flash", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }], usage: { total_tokens: 80 } }), { status: 200, headers: { "content-type": "application/json" } }));

    const result = await new DeepSeekModelGateway("key", fetchMock).qualifyDiscoveryLeads({ query: "半导体投资", leads: [{ id: "lead-1", title: "中科创星投资穹芯微电子", url: "https://example.com/1", highlights: ["穹芯微电子完成新一轮融资。"] }] });

    expect(result[0].signalType).toBe("funding");
    expect(result[0].track).toBe("半导体");
  });

  it("rejects discovery entities that are absent from the supplied lead", async () => {
    const content = { assessments: [{ leadId: "lead-1", relevant: true, companyName: "虚构公司", track: "半导体", investorNames: [], signalType: "investment", summary: "x", confidence: 0.8 }] };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "ds-4", model: "deepseek-v4-flash", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }], usage: { total_tokens: 40 } }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(new DeepSeekModelGateway("key", fetchMock).qualifyDiscoveryLeads({ query: "半导体投资", leads: [{ id: "lead-1", title: "某投资动态", url: "https://example.com/1", highlights: ["未披露公司名称。"] }] })).rejects.toThrow(/ungrounded company/i);
  });
});
