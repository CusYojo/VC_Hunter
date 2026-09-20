import type { ModuleRef, VersionedModule } from "@/runtime/module-registry";

export type PromptRef = ModuleRef;

export interface RenderedPrompt {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

export interface PromptModule<TInput = unknown> extends VersionedModule {
  system: string;
  maxTokens?: number;
  temperature?: number;
  source?: string;
  renderUser(input: TInput): string;
}

export interface ResolvedPrompt<TInput = unknown> extends PromptModule<TInput> {
  hash: string;
  render(input: TInput): RenderedPrompt;
}
