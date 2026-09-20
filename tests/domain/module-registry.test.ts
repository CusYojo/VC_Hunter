import { describe, expect, it } from "vitest";
import { VersionedRegistry } from "@/runtime/module-registry";

describe("versioned module registry", () => {
  it("resolves exact immutable versions and rejects duplicate registrations", () => {
    const first = { id: "project-discovery", version: "1.0.0", value: "v1" };
    const registry = new VersionedRegistry<{ id: string; version: string; value: string }>([first]);

    expect(registry.resolve({ id: "project-discovery", version: "1.0.0" })).toEqual(first);
    expect(registry.list()).toEqual([first]);
    expect(() => registry.register({ ...first, value: "changed" })).toThrow(/already registered/i);
    expect(Object.isFrozen(registry.resolve({ id: "project-discovery", version: "1.0.0" }))).toBe(true);
  });

  it("fails closed for unknown ids or versions", () => {
    const registry = new VersionedRegistry([{ id: "project-research", version: "1.0.0" }]);

    expect(() => registry.resolve({ id: "missing", version: "1.0.0" })).toThrow(/not registered/i);
    expect(() => registry.resolve({ id: "project-research", version: "2.0.0" })).toThrow(/not registered/i);
  });
});
