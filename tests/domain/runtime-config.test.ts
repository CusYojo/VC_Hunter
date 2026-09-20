import { describe, expect, it } from "vitest";
import { parseRuntimeConfig } from "@/runtime/runtime-config";

describe("agent runtime config", () => {
  it("applies safe built-in defaults", () => {
    expect(parseRuntimeConfig({})).toMatchObject({
      schemaVersion: 1,
      defaults: {
        searchProvider: "deepseek-web-search",
        discoveryWorkflow: { id: "project-discovery", version: "1.0.0" },
        researchWorkflow: { id: "project-research", version: "1.0.0" },
      },
    });
  });

  it("accepts data-only prompt revisions and rejects executable module paths", () => {
    const config = parseRuntimeConfig({
      promptModules: [{ id: "lead-qualification", version: "2.0.0", system: "approved prompt", userTemplate: "{{inputJson}}" }],
    });
    expect(config.promptModules[0].version).toBe("2.0.0");
    expect(() => parseRuntimeConfig({ modulePath: "../../evil.ts" })).toThrow();
    expect(() => parseRuntimeConfig({ promptModules: [{ id: "x", version: "1.0.0", system: "x", userTemplate: "{{unknown}}" }] })).toThrow();
  });
});
