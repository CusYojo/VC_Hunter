import { AsyncLocalStorage } from "node:async_hooks";
import type { CurrentUser } from "@/workbench/contracts";

export interface WorkspaceIdentity {
  readonly user: CurrentUser;
  readonly tenantId: string;
  readonly accountId: string;
  readonly roles: readonly string[];
}

export const identityScope = new AsyncLocalStorage<WorkspaceIdentity>();

export function authenticationRequired(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VC_HUNTER_AUTH_ENABLED === "true";
}
