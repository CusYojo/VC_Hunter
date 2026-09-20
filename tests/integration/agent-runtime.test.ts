import { describe, expect, it, vi } from "vitest";
import { createDatabase, initializeDatabase } from "@/db/client";
import { createAgentRuntime } from "@/runtime/create-agent-runtime";

describe("agent runtime composition", () => {
  it("selects registered providers and a data-only custom prompt revision", async () => {
    const database = createDatabase(":memory:");
    initializeDatabase(database);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "request-1", model: "deepseek-v4-flash", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ summary: "研究", findings: [{ claim: "事实", evidenceIds: ["e-1"] }], risks: [], openQuestions: [] }) } }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const runtime = createAgentRuntime({
      database,
      env: { NODE_ENV: "test", MODEL_PROVIDER: "deepseek", MODEL_NAME: "deepseek-v4-flash", DEEPSEEK_API_KEY: "test-key" },
      fetchImpl: fetchMock,
      config: {
        defaults: {
          searchProvider: "exa",
          prompts: { researchBrief: { id: "research-brief", version: "2.0.0" } },
        },
        promptModules: [{ id: "research-brief", version: "2.0.0", system: "CUSTOM RESEARCH PROMPT", userTemplate: "{{inputJson}}" }],
      },
    });

    const result = await runtime.analysis.generateResearchBriefWithLineage({ projectName: "项目", track: "半导体", evidence: [{ id: "e-1", quote: "事实", authority: "A" }] });

    expect(runtime.defaultSearchProvider.name).toBe("exa");
    expect(runtime.skills.resolve("generate-research-brief", "1.0.0")).toBeDefined();
    expect(result.lineage.prompt).toMatchObject({ id: "research-brief", version: "2.0.0" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content).toBe("CUSTOM RESEARCH PROMPT");
  });

  it("rejects attempts to overwrite a built-in prompt revision", () => {
    const database = createDatabase(":memory:");
    initializeDatabase(database);
    expect(() => createAgentRuntime({
      database,
      env: { NODE_ENV: "test", DEEPSEEK_API_KEY: "test-key" },
      config: { promptModules: [{ id: "research-brief", version: "1.0.0", system: "overwrite", userTemplate: "{{inputJson}}" }] },
    })).toThrow(/already registered/i);
  });

  it("rejects changing a custom prompt body without a new version after restart", () => {
    const database = createDatabase(":memory:");
    initializeDatabase(database);
    const base = { defaults: { prompts: { researchBrief: { id: "research-brief", version: "2.0.0" } } } };
    createAgentRuntime({ database, env: { NODE_ENV: "test", DEEPSEEK_API_KEY: "key" }, config: { ...base, promptModules: [{ id: "research-brief", version: "2.0.0", system: "first", userTemplate: "{{inputJson}}" }] } });

    expect(() => createAgentRuntime({ database, env: { NODE_ENV: "test", DEEPSEEK_API_KEY: "key" }, config: { ...base, promptModules: [{ id: "research-brief", version: "2.0.0", system: "changed", userTemplate: "{{inputJson}}" }] } })).toThrow(/hash changed/i);
  });
});
