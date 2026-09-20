import type { DatabaseSync } from "node:sqlite";
import type { WorkspaceIdentity } from "@/security/identity-scope";
import { getSavedAISettings } from "./settings-repository";
export type PersonalSearchMode = "local-index" | "deepseek-web-search" | "exa";
export function personalSearchMode(database: DatabaseSync, identity: Pick<WorkspaceIdentity, "tenantId" | "accountId"> | undefined, env: NodeJS.ProcessEnv = process.env): PersonalSearchMode {
  if (env.VC_HUNTER_EXA_ENABLED !== "false" && env.EXA_API_KEY?.trim()) return "exa";
  if (identity && getSavedAISettings(database, identity).activeProvider === "deepseek") return "deepseek-web-search";
  return "local-index";
}
