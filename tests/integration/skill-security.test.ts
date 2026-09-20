import { afterEach, describe, expect, it } from "vitest";
import { handleExecuteSkill } from "@/api/skill-handlers";

describe("skill execution boundary", () => {
  const originalEnabled = process.env.ENABLE_SKILL_EXECUTION;
  const originalToken = process.env.SKILL_EXECUTION_TOKEN;

  afterEach(() => {
    if (originalEnabled === undefined) delete process.env.ENABLE_SKILL_EXECUTION; else process.env.ENABLE_SKILL_EXECUTION = originalEnabled;
    if (originalToken === undefined) delete process.env.SKILL_EXECUTION_TOKEN; else process.env.SKILL_EXECUTION_TOKEN = originalToken;
  });

  it("is disabled by default", async () => {
    delete process.env.ENABLE_SKILL_EXECUTION;
    const response = await handleExecuteSkill(new Request("http://localhost/api/v1/skills/analyze_project/execute", { method: "POST", body: "{}" }), "analyze_project");
    expect(response.status).toBe(404);
  });

  it("requires a configured bearer token before reading the request body", async () => {
    process.env.ENABLE_SKILL_EXECUTION = "true";
    process.env.SKILL_EXECUTION_TOKEN = "a-secure-development-token";
    const response = await handleExecuteSkill(new Request("http://localhost/api/v1/skills/analyze_project/execute", {
      method: "POST", headers: { "content-type": "application/json", "content-length": "999999" }, body: "{}",
    }), "analyze_project");
    expect(response.status).toBe(401);
  });

  it("remains fail-closed after authentication until server-side evidence policy resolution exists", async () => {
    process.env.ENABLE_SKILL_EXECUTION = "true";
    process.env.SKILL_EXECUTION_TOKEN = "a-secure-development-token";
    const response = await handleExecuteSkill(new Request("http://localhost/api/v1/skills/analyze_project/execute", {
      method: "POST", headers: { authorization: "Bearer a-secure-development-token" }, body: JSON.stringify({ modelShareable: true, quote: "caller supplied" }),
    }), "analyze_project");
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("COMPLIANCE_BLOCKED");
  });
});
