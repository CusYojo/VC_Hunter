import { describe, expect, it, vi } from "vitest";
import { StructuredAnalysisGateway } from "@/analysis/structured-analysis-gateway";
import { ModelGateway } from "@/connectors/model-gateway";
import { createBuiltinPromptRegistry } from "@/prompts/catalog";

function modelResponse(data: unknown) {
  return new Response(JSON.stringify({
    id: "model-request-1",
    model: "deepseek-v4-flash",
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(data) } }],
    usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("structured analysis gateway", () => {
  it("resolves a pinned research prompt and returns auditable lineage", async () => {
    const fetchMock = vi.fn().mockResolvedValue(modelResponse({ summary: "结论", findings: [{ claim: "事实", evidenceIds: ["e-1"] }], risks: [], openQuestions: [] }));
    const model = new ModelGateway({ provider: "deepseek", apiKey: "key", baseUrl: "https://api.deepseek.com/chat/completions", model: "deepseek-v4-flash", fetchImpl: fetchMock });
    const gateway = new StructuredAnalysisGateway(model, createBuiltinPromptRegistry());

    const result = await gateway.generateResearchBriefWithLineage({ projectName: "项目", track: "半导体", evidence: [{ id: "e-1", quote: "已送测", authority: "A" }] });

    expect(result.data.summary).toBe("结论");
    expect(result.lineage).toMatchObject({ prompt: { id: "research-brief", version: "1.0.0" }, provider: "deepseek", actualModel: "deepseek-v4-flash" });
    expect(result.lineage.prompt.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps deterministic grounding checks inside the analysis module", async () => {
    const fetchMock = vi.fn().mockResolvedValue(modelResponse({ summary: "x", findings: [{ claim: "编造", evidenceIds: ["missing"] }], risks: [], openQuestions: [] }));
    const model = new ModelGateway({ provider: "deepseek", apiKey: "key", baseUrl: "https://api.deepseek.com/chat/completions", model: "m", fetchImpl: fetchMock });
    const gateway = new StructuredAnalysisGateway(model, createBuiltinPromptRegistry());

    await expect(gateway.generateResearchBrief({ projectName: "项目", track: "半导体", evidence: [{ id: "e-1", quote: "事实", authority: "A" }] })).rejects.toThrow(/unknown evidence/i);
  });
});
