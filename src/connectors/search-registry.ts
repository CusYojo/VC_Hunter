import type { WebSearchProvider } from "./web-search";
import { VersionedRegistry, type ModuleRef } from "@/runtime/module-registry";

interface SearchProviderModule {
  id: string;
  version: string;
  provider: WebSearchProvider;
}

export class SearchProviderRegistry {
  private readonly modules = new VersionedRegistry<SearchProviderModule>();

  register(ref: ModuleRef, provider: WebSearchProvider): this {
    this.modules.register({ ...ref, provider });
    return this;
  }

  resolve(ref: ModuleRef): WebSearchProvider {
    return this.modules.resolve(ref).provider;
  }

  list(): ReadonlyArray<ModuleRef & { name: string }> {
    return this.modules.list().map((module) => ({ id: module.id, version: module.version, name: module.provider.name }));
  }
}
