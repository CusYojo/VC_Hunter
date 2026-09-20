import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { readAuthFixture } from "./fixtures";
import { login } from "./login";

test("built Next server reads local PDF workers and Chinese CMaps and returns actionable failures", async ({ browser }) => {
  const origin = "http://127.0.0.1:3107";
  const context = await browser.newContext({ baseURL: origin });
  try {
    await login(await context.newPage(), readAuthFixture().member);
    const priorRuns = (await (await context.request.get("/api/v1/ai/runs")).json()).data;
    const extract = (name: string, mimeType = "application/pdf") => context.request.post("/api/v1/ai/extract", {
      headers: { origin },
      multipart: { file: { name, mimeType, buffer: readFileSync(resolve("tests/fixtures/pdf", name)) } },
    });
    const result = await extract("chinese-multipage.pdf", "application/octet-stream");
    const payload = await result.json();
    if (result.status() !== 200) throw new Error(`PDF extraction HTTP ${result.status()} code ${payload.error?.code ?? "unknown"}`);
    const data = payload.data;
    expect(data.text).toContain("工程样机验证完成");
    expect(data.text).toContain("下一步可靠性测试");
    for (const [name, code] of [["image-only.pdf", "PDF_NO_TEXT"], ["password-protected.pdf", "PDF_PASSWORD_REQUIRED"]]) {
      const response = await extract(name);
      expect(response.status()).toBe(400);
      expect((await response.json()).error.code).toBe(code);
    }
    // Local extraction must not create billable model runs.
    expect((await (await context.request.get("/api/v1/ai/runs")).json()).data).toEqual(priorRuns);
  } finally { await context.close(); }
});
