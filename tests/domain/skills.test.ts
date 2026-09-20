import { describe, expect, it } from "vitest";
import { getSkillDefinition, listSkillDefinitions, SkillRegistry } from "@/skills";
import { SkillExecutor } from "@/skills";
import { ModelGateway } from "@/connectors/model-gateway";

const gateway = new ModelGateway({
  provider: "deepseek",
  apiKey: "unused",
  baseUrl: "https://api.deepseek.com/chat/completions",
  model: "deepseek-v4-flash",
});

describe("skill platform", () => {
  it("exposes the eight standard skills with stable contracts", () => {
    const skills = listSkillDefinitions();
    expect(skills.map((skill) => skill.id)).toEqual([
      "collect_data",
      "clean_data",
      "resolve_entities",
      "enrich_project",
      "analyze_project",
      "build_talent_profile",
      "generate_knowledge_card",
      "write_research_report",
    ]);
    for (const skill of skills) {
      expect(skill.version).toBeTruthy();
      expect(skill.promptVersion).toBeTruthy();
    }
  });

  it("rejects unknown skills with a SCHEMA_INVALID error", async () => {
    const executor = new SkillExecutor({ gateway, provider: "deepseek", modelVersion: "deepseek-v4-flash" });
    const result = await executor.execute("not_a_skill", {
      taskId: "t1",
      skill: "not_a_skill",
      scope: { region: "CN-mainland", tracks: ["半导体"], asOf: "2026-08-31" },
      input: {},
    });

    expect(result.status).toBe("failed");
    expect(result.errors[0].code).toBe("SCHEMA_INVALID");
  });

  it("validates input against the skill schema before calling the model", async () => {
    const executor = new SkillExecutor({ gateway, provider: "deepseek", modelVersion: "deepseek-v4-flash" });
    const result = await executor.execute("analyze_project", {
      taskId: "t2",
      skill: "analyze_project",
      scope: { region: "CN-mainland", tracks: ["半导体"], asOf: "2026-08-31" },
      input: { projectName: "x" }, // missing projectId/track/evidence
    });

    expect(result.status).toBe("failed");
    expect(result.errors[0].code).toBe("SCHEMA_INVALID");
  });

  it("has evidence-gated prompts for enrichment skills", () => {
    const enrich = getSkillDefinition("enrich_project");
    expect(enrich?.systemPrompt).toMatch(/not_disclosed/);
    const analyze = getSkillDefinition("analyze_project");
    expect(analyze?.systemPrompt).toMatch(/evidenceIds/);
  });

  it("executes a registered deterministic skill without invoking a model", async () => {
    const deterministic = new SkillRegistry().register({
      definition: {
        id: "echo", version: "1.0.0", promptVersion: "none", description: "echo", requiresModel: false,
        inputSchema: (await import("zod")).z.object({ value: (await import("zod")).z.string() }),
        outputSchema: (await import("zod")).z.object({ value: (await import("zod")).z.string() }),
        systemPrompt: "unused",
      },
      execute: async (_context, input) => ({ value: input.value }),
    });
    const executor = new SkillExecutor({ gateway, provider: "local", modelVersion: "none", registry: deterministic });

    const result = await executor.execute("echo", { taskId: "t3", skill: "echo", scope: { region: "CN", tracks: ["AI"], asOf: "2026-09-01" }, input: { value: "ok" } });

    expect(result).toMatchObject({ status: "ok", data: { value: "ok" }, confidence: 1 });
  });

  it("rejects hallucinated evidence ids and does not expose raw model errors", async () => {
    const fetchMock = (await import("vitest")).vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "m1", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ summary: "x", technology: { stage: "x", rationale: "x", openQuestions: [] }, market: { tam: null, rationale: "x", openQuestions: [] }, team: { strengths: [], gaps: [] }, competitiveMoat: "x", risks: [], evidenceIds: ["invented"] }) } }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const model = new ModelGateway({ provider: "deepseek", apiKey: "key", baseUrl: "https://api.deepseek.com/chat/completions", model: "m", fetchImpl: fetchMock });
    const executor = new SkillExecutor({ gateway: model, provider: "deepseek", modelVersion: "m" });

    const result = await executor.execute("analyze_project", {
      taskId: "t4", skill: "analyze_project", scope: { region: "CN", tracks: ["半导体"], asOf: "2026-09-01" },
      input: { projectId: "p", projectName: "项目", track: "半导体", evidence: [{ id: "e-1", quote: "事实", authority: "A" }] },
    });

    expect(result.status).toBe("failed");
    expect(result.errors[0]).toEqual({ code: "SCHEMA_INVALID", message: "Skill output failed deterministic validation." });
  });
});
