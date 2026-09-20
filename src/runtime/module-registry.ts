export interface ModuleRef {
  id: string;
  version: string;
}

export type VersionedModule = ModuleRef;

function moduleKey(ref: ModuleRef): string {
  return `${ref.id}@${ref.version}`;
}

/**
 * 运行时只解析启动时注册的内置模块，配置文件不能指定文件路径或动态代码。
 * 每个 id/version 都是不可覆盖的发布单元。
 */
export class VersionedRegistry<TModule extends VersionedModule> {
  private readonly modules = new Map<string, TModule>();

  constructor(entries: readonly TModule[] = []) {
    for (const entry of entries) this.register(entry);
  }

  register(entry: TModule): this {
    const key = moduleKey(entry);
    if (this.modules.has(key)) throw new Error(`Module is already registered: ${key}`);
    this.modules.set(key, Object.freeze({ ...entry }));
    return this;
  }

  resolve(ref: ModuleRef): TModule {
    const key = moduleKey(ref);
    const entry = this.modules.get(key);
    if (!entry) throw new Error(`Module is not registered: ${key}`);
    return entry;
  }

  list(): readonly TModule[] {
    return Object.freeze(Array.from(this.modules.values()));
  }
}
