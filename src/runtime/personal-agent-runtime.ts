import { LocalPublicSearchProvider, PublicSearchFallback } from "@/connectors/local-public-search";
import type { DatabaseSync } from "node:sqlite";
import { StructuredAnalysisGateway } from "@/analysis/structured-analysis-gateway";
import { createJobModelGateway, resolveJobAIRequester } from "@/ai/job-requesters";
import { getDecryptedSelectedConfiguration } from "@/ai/settings-repository";
import { DeepSeekWebSearchProvider, ExaSearchProvider, type WebSearchProvider } from "@/connectors/web-search";
import { SearchProviderRegistry } from "@/connectors/search-registry";
import { createBuiltinWorkflowRegistry, type PersonalRuntimeResolver } from "@/services/background-agent";
import { SqliteBackgroundAgentRepository } from "@/repositories/background-agent";
import type { AgentRuntime } from "./create-agent-runtime";
export function createPersonalRuntimeResolver(database: DatabaseSync, runtime: Pick<AgentRuntime, "prompts" | "config">, env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): PersonalRuntimeResolver {
  return (type, jobId) => {
    const model = createJobModelGateway(database, type, jobId, fetchImpl);
    const analysis = new StructuredAnalysisGateway(model, runtime.prompts, runtime.config.defaults.prompts);
    let searchProvider: WebSearchProvider = new LocalPublicSearchProvider(database);
    if (env.VC_HUNTER_EXA_ENABLED !== "false" && env.EXA_API_KEY?.trim()) searchProvider = new PublicSearchFallback(new ExaSearchProvider(env.EXA_API_KEY, fetchImpl), new LocalPublicSearchProvider(database));
    else if (model.provider === "deepseek") {
      const config = getDecryptedSelectedConfiguration(database, resolveJobAIRequester(database, type, jobId))!;
      searchProvider = new DeepSeekWebSearchProvider(config.apiKey, fetchImpl, config.model, runtime.prompts.resolve(runtime.config.defaults.prompts.webSearch));
    }
    const searchProviders = new SearchProviderRegistry().register({ id: "deepseek-web-search", version: "1.0.0" }, searchProvider).register({ id: "exa", version: "1.0.0" }, searchProvider);
    return { researchGateway: analysis, searchProvider, workflows: createBuiltinWorkflowRegistry(new SqliteBackgroundAgentRepository(database), searchProviders, analysis) };
  };
}
