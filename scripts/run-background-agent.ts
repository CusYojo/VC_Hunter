import { createPersonalRuntimeResolver } from "../src/runtime/personal-agent-runtime";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { getDatabase } from "../src/db/client";
import { createAgentRuntime, loadRuntimeConfigFile } from "../src/runtime/create-agent-runtime";
import { runBackgroundAgentCycle, syncAgentManifest, type AgentManifest } from "../src/services/background-agent";
import { createDocumentExternalAnalyzer } from "../src/workbench/documents";

const once = process.argv.includes("--once");
const syncOnly = process.argv.includes("--sync-only");
const manifestPath = resolve(process.env.VC_HUNTER_AGENT_CONFIG ?? "config/agent.local.json");
const pollMilliseconds = parsePollMilliseconds(process.env.VC_HUNTER_AGENT_POLL_MS);
const runtimeConfigPath = resolve(process.env.VC_HUNTER_RUNTIME_CONFIG ?? "config/runtime.local.json");
const database = getDatabase();
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as AgentManifest;
const runtimeConfig = await loadRuntimeConfigFile(runtimeConfigPath, Boolean(process.env.VC_HUNTER_RUNTIME_CONFIG));
syncAgentManifest(database, manifest, new Date().toISOString(), {
  discoveryWorkflow: runtimeConfig.defaults.discoveryWorkflow,
  searchProvider: runtimeConfig.defaults.searchProvider,
});

if (syncOnly) {
  process.stdout.write(`${JSON.stringify({ ok: true, manifestPath, searchPlans: manifest.searchPlans.length })}\n`);
  process.exit(0);
}

const runtime = createAgentRuntime({ database, config: runtimeConfig });
const workerId = `local-${process.pid}-${randomUUID().slice(0, 8)}`;
let stopping = false;

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

do {
  const result = await safeDrainAvailableWork();
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), workerId, ...result })}\n`);
  if (once || stopping) break;
  await wait(pollMilliseconds);
} while (!stopping);

async function drainAvailableWork(): Promise<{ searchRuns: number; discoveryRuns: number; intelligenceRuns: number; researchRuns: number; documentRuns: number; digestPublished: boolean; failures: number }> {
  let total = { searchRuns: 0, discoveryRuns: 0, intelligenceRuns: 0, researchRuns: 0, documentRuns: 0, digestPublished: false, failures: 0 };
  for (let cycle = 0; cycle < 100 && !stopping; cycle += 1) {
    const result = await runBackgroundAgentCycle({ repository: runtime.repository, searchProvider: runtime.defaultSearchProvider, searchProviders: runtime.searchProviders, researchGateway: runtime.analysis, resolvePersonalRuntime: createPersonalRuntimeResolver(database, runtime), workflows: runtime.workflows, documentAnalyzer: createDocumentExternalAnalyzer(runtime.model), workerId });
    total = {
      searchRuns: total.searchRuns + result.searchRuns,
      discoveryRuns: total.discoveryRuns + result.discoveryRuns,
      intelligenceRuns: total.intelligenceRuns + result.intelligenceRuns,
      researchRuns: total.researchRuns + result.researchRuns,
      documentRuns: total.documentRuns + result.documentRuns,
      digestPublished: total.digestPublished || result.digestPublished,
      failures: total.failures + result.failures,
    };
    if (result.searchRuns + result.discoveryRuns + result.intelligenceRuns + result.researchRuns + result.documentRuns === 0) break;
  }
  return total;
}

async function safeDrainAvailableWork(): Promise<{ searchRuns: number; discoveryRuns: number; intelligenceRuns: number; researchRuns: number; documentRuns: number; digestPublished: boolean; failures: number; errorCode?: string }> {
  try {
    return await drainAvailableWork();
  } catch {
    return { searchRuns: 0, discoveryRuns: 0, intelligenceRuns: 0, researchRuns: 0, documentRuns: 0, digestPublished: false, failures: 1, errorCode: "AGENT_CYCLE_FAILED" };
  }
}

function parsePollMilliseconds(rawValue: string | undefined): number {
  const value = Number(rawValue ?? 30_000);
  if (!Number.isInteger(value) || value < 1_000 || value > 300_000) throw new Error("VC_HUNTER_AGENT_POLL_MS must be between 1000 and 300000.");
  return value;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}
