import { getDatabase } from "../src/db/client";
import { SqliteProjectRepository } from "../src/repositories/projects";
import { createAgentRuntime, loadRuntimeConfigFile } from "../src/runtime/create-agent-runtime";
import { resolve } from "node:path";

const projectIndex = process.argv.indexOf("--project");
const projectId = projectIndex >= 0 ? process.argv[projectIndex + 1] : undefined;
if (!projectId) throw new Error("Usage: npm run research:deepseek -- --project <project-id>");
const database = getDatabase();
const project = new SqliteProjectRepository(database).findById(projectId);
if (!project) throw new Error("Project not found.");
const evidence = Array.from(new Map(project.assertions.flatMap((assertion) => assertion.evidence).filter((item) => item.modelShareable).map((item) => [item.id, item])).values())
  .slice(0, 50)
  .map((item) => ({ id: item.id, quote: item.quote, authority: item.authority }));
if (evidence.length === 0) throw new Error("Project has no evidence that may be sent to the model gateway.");
const runtimeConfigPath = resolve(process.env.VC_HUNTER_RUNTIME_CONFIG ?? "config/runtime.local.json");
const runtime = createAgentRuntime({ database, config: await loadRuntimeConfigFile(runtimeConfigPath, Boolean(process.env.VC_HUNTER_RUNTIME_CONFIG)) });
const result = await runtime.analysis.generateResearchBriefWithLineage({ projectName: project.name, track: project.track, evidence });
process.stdout.write(`${JSON.stringify({ projectId, lineage: result.lineage, result: result.data })}\n`);
