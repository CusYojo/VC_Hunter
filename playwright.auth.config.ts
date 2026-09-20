import { defineConfig, devices } from "@playwright/test";
import { join } from "node:path";

const directory = process.env.VC_HUNTER_AUTH_E2E_DIRECTORY;
if (!directory) throw new Error("Run this configuration via scripts/auth-e2e.ts only");

export default defineConfig({
  testDir: "./tests/auth-e2e", testMatch: "*.spec.ts",
  fullyParallel: false, workers: 1, retries: 0, timeout: 120_000,
  reporter: [["./tests/auth-e2e/reporter.ts"]],
  outputDir: join(directory, "test-output"), preserveOutput: "never",
  use: { baseURL: "http://127.0.0.1:3107", trace: "off", screenshot: "off", video: "off" },
  projects: [{ name: "authenticated-chromium", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
});
