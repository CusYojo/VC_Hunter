import { createHash } from "node:crypto";
import { VersionedRegistry, type ModuleRef } from "@/runtime/module-registry";
import type { PromptModule, ResolvedPrompt } from "./contract";

export class PromptRegistry {
  private readonly modules = new VersionedRegistry<PromptModule>();

  constructor(prompts: readonly PromptModule[] = []) {
    for (const prompt of prompts) this.register(prompt);
  }

  register<TInput>(prompt: PromptModule<TInput>): this {
    validatePrompt(prompt);
    this.modules.register(prompt as PromptModule);
    return this;
  }

  resolve<TInput = unknown>(ref: ModuleRef): ResolvedPrompt<TInput> {
    const prompt = this.modules.resolve(ref) as PromptModule<TInput>;
    const hash = createHash("sha256").update(`${prompt.system}\0${prompt.source ?? prompt.renderUser.toString()}`).digest("hex");
    return Object.freeze({
      ...prompt,
      hash,
      render: (input: TInput) => ({
        system: prompt.system,
        user: prompt.renderUser(input),
        ...(prompt.maxTokens === undefined ? {} : { maxTokens: prompt.maxTokens }),
        ...(prompt.temperature === undefined ? {} : { temperature: prompt.temperature }),
      }),
    });
  }

  list(): readonly PromptModule[] {
    return this.modules.list();
  }
}

function validatePrompt(prompt: PromptModule): void {
  if (!/^[a-z0-9][a-z0-9_-]{1,99}$/.test(prompt.id)) throw new Error("Prompt id is invalid.");
  if (!/^\d+\.\d+\.\d+$/.test(prompt.version)) throw new Error("Prompt version must use semantic versioning.");
  if (!prompt.system.trim() || prompt.system.length > 20_000) throw new Error("Prompt system text is invalid.");
}
