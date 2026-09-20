import { randomUUID } from "node:crypto";
import { getDatabase } from "../src/db/client";
import { SqliteWebSearchRepository } from "../src/repositories/web-search";
import { createAgentRuntime, loadRuntimeConfigFile } from "../src/runtime/create-agent-runtime";
import { discoverWebLeads } from "../src/services/web-search";
import { resolve } from "node:path";

const queryIndex = process.argv.indexOf("--query");
const limitIndex = process.argv.indexOf("--limit");
const query = queryIndex >= 0 ? process.argv[queryIndex + 1] : undefined;
const limit = limitIndex >= 0 ? Number(process.argv[limitIndex + 1]) : 10;
if (!query) throw new Error("Usage: npm run search:web -- --query <query> [--limit 10]");
const database = getDatabase();
const runtimeConfigPath = resolve(process.env.VC_HUNTER_RUNTIME_CONFIG ?? "config/runtime.local.json");
const runtime = createAgentRuntime({ database, config: await loadRuntimeConfigFile(runtimeConfigPath, Boolean(process.env.VC_HUNTER_RUNTIME_CONFIG)) });

const receipt = await discoverWebLeads(
  new SqliteWebSearchRepository(database),
  runtime.defaultSearchProvider,
  { query, limit, traceId: randomUUID(), observedAt: new Date().toISOString() },
);
process.stdout.write(`${JSON.stringify(receipt)}\n`);
