import { lstat, readFile } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import { StructuredAnalysisGateway } from "@/analysis/structured-analysis-gateway";
import { resolveModelGateway, type ModelGateway } from "@/connectors/model-gateway";
import { SearchProviderRegistry } from "@/connectors/search-registry";
import { DeepSeekWebSearchProvider, ExaSearchProvider, type WebSearchProvider } from "@/connectors/web-search";
import { createBuiltinPromptRegistry } from "@/prompts/catalog";
import type { PromptRegistry } from "@/prompts/registry";
import { SqliteBackgroundAgentRepository } from "@/repositories/background-agent";
import { createBuiltinWorkflowRegistry } from "@/services/background-agent";
import type { WorkflowRegistry } from "@/workflows/registry";
import { createAgentSkillRegistry } from "@/skills/agent-skills";
import type { SkillRegistry } from "@/skills/registry";
import { parseRuntimeConfig, type RuntimeConfig, type RuntimePromptModuleConfig } from "./runtime-config";

export interface AgentRuntime {
  config: RuntimeConfig;
  prompts: PromptRegistry;
  model: ModelGateway;
  analysis: StructuredAnalysisGateway;
  searchProviders: SearchProviderRegistry;
  defaultSearchProvider: WebSearchProvider;
  repository: SqliteBackgroundAgentRepository;
  skills: SkillRegistry;
  workflows: WorkflowRegistry;
}

export function createAgentRuntime(input: {
  database: DatabaseSync;
  env?: NodeJS.ProcessEnv;
  config?: unknown;
  fetchImpl?: typeof fetch;
}): AgentRuntime {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const config = parseRuntimeConfig(input.config ?? {});
  const prompts = createBuiltinPromptRegistry();
  for (const prompt of config.promptModules) prompts.register(toPromptModule(prompt));
  prompts.resolve(config.defaults.prompts.webSearch);
  prompts.resolve(config.defaults.prompts.leadQualification);
  prompts.resolve(config.defaults.prompts.researchBrief);
  assertPersistentPromptRevisions(input.database, prompts);

  const model = resolveModelGateway(env, fetchImpl);
  const analysis = new StructuredAnalysisGateway(model, prompts, config.defaults.prompts);
  const searchProviders = new SearchProviderRegistry()
    .register({ id: "deepseek-web-search", version: "1.0.0" }, new DeepSeekWebSearchProvider(env.DEEPSEEK_API_KEY ?? "", fetchImpl, env.DEEPSEEK_MODEL ?? env.MODEL_NAME ?? "deepseek-v4-flash", prompts.resolve(config.defaults.prompts.webSearch)))
    .register({ id: "exa", version: "1.0.0" }, new ExaSearchProvider(env.EXA_API_KEY ?? "", fetchImpl));
  const defaultSearchProvider = searchProviders.resolve({ id: config.defaults.searchProvider, version: "1.0.0" });
  const repository = new SqliteBackgroundAgentRepository(input.database);
  const skills = createAgentSkillRegistry(analysis);
  const workflows = createBuiltinWorkflowRegistry(repository, searchProviders, analysis, skills);
  workflows.resolve(config.defaults.discoveryWorkflow);
  workflows.resolve(config.defaults.researchWorkflow);
  return { config, prompts, model, analysis, searchProviders, defaultSearchProvider, repository, skills, workflows };
}

export async function loadRuntimeConfigFile(path: string, explicitPath = false): Promise<RuntimeConfig> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isFile()) throw new Error("Runtime config must be a regular file.");
    if (stats.size > 262_144) throw new Error("Runtime config exceeds the 256KB limit.");
    return parseRuntimeConfig(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !explicitPath) return parseRuntimeConfig({});
    throw error;
  }
}

function toPromptModule(config: RuntimePromptModuleConfig) {
  return {
    id: config.id,
    version: config.version,
    system: config.system,
    source: `${config.system}\n${config.userTemplate}`,
    ...(config.maxTokens === undefined ? {} : { maxTokens: config.maxTokens }),
    ...(config.temperature === undefined ? {} : { temperature: config.temperature }),
    renderUser: (value: unknown) => config.userTemplate.replaceAll("{{inputJson}}", JSON.stringify(value)),
  };
}

function assertPersistentPromptRevisions(database: DatabaseSync, prompts: PromptRegistry): void {
  const find = database.prepare("SELECT content_hash FROM prompt_revisions WHERE prompt_id=? AND prompt_version=?");
  const insert = database.prepare("INSERT INTO prompt_revisions (prompt_id,prompt_version,content_hash,created_at) VALUES (?,?,?,?)");
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const prompt of prompts.list()) {
      const resolved = prompts.resolve({ id: prompt.id, version: prompt.version });
      const existing = find.get(prompt.id, prompt.version) as { content_hash: string } | undefined;
      if (existing && existing.content_hash !== resolved.hash) throw new Error(`Prompt revision hash changed: ${prompt.id}@${prompt.version}`);
      if (!existing) insert.run(prompt.id, prompt.version, resolved.hash, new Date().toISOString());
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
