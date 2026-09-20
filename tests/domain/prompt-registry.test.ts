import { describe, expect, it } from "vitest";
import { createBuiltinPromptRegistry } from "@/prompts/catalog";
import { PromptRegistry } from "@/prompts/registry";

describe("prompt registry", () => {
  it("keeps production prompts independently versioned and renderable", () => {
    const prompts = createBuiltinPromptRegistry();

    const search = prompts.resolve({ id: "investment-web-search", version: "1.0.0" });
    const rendered = search.render({ query: "半导体投资", limit: 5 });
    expect(rendered.system).toContain("联网搜索");
    expect(rendered.user).toContain("半导体投资");

    const qualification = prompts.resolve({ id: "lead-qualification", version: "1.0.0" });
    expect(qualification.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("allows a new prompt version but never overwrites an existing revision", () => {
    const prompts = new PromptRegistry();
    prompts.register({ id: "research-brief", version: "2.0.0", system: "new", renderUser: (input) => JSON.stringify(input) });

    expect(prompts.resolve({ id: "research-brief", version: "2.0.0" }).render({ project: "A" }).system).toBe("new");
    expect(() => prompts.register({ id: "research-brief", version: "2.0.0", system: "changed", renderUser: String })).toThrow(/already registered/i);
  });
});
