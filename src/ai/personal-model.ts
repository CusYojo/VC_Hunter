import type { DatabaseSync } from "node:sqlite";
import type { WorkspaceIdentity } from "@/security/identity-scope";
import { ModelGateway } from "@/connectors/model-gateway";
import { getDecryptedSelectedConfiguration } from "./settings-repository";
import { getAiProvider } from "./providers";

export class PersonalAIRequiredError extends Error {
  readonly code = "PERSONAL_AI_REQUIRED";
  constructor() { super("请先在设置中保存并选择自己的 AI API 和模型。"); }
}
export function createPersonalModelGateway(database: DatabaseSync, identity: Pick<WorkspaceIdentity, "tenantId" | "accountId">, fetchImpl: typeof fetch = fetch): ModelGateway {
  const config = getDecryptedSelectedConfiguration(database, identity);
  if (!config) throw new PersonalAIRequiredError();
  return new ModelGateway({ ...config, baseUrl: getAiProvider(config.provider).endpoint, fetchImpl });
}
