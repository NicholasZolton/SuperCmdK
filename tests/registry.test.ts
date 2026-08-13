import { describe, expect, it, vi } from "vitest";
import { ScopedRegistry } from "../src/registry";

describe("ScopedRegistry", () => {
  it("registers, overrides, and cleans up page scopes", () => {
    const registry = new ScopedRegistry<{ id: string; value: number }>();
    const listener = vi.fn();
    registry.subscribe(listener);

    const removeGlobal = registry.register([{ id: "open", value: 1 }, { id: "help", value: 2 }]);
    const removePage = registry.register([{ id: "open", value: 3 }]);

    expect(registry.getSnapshot()).toEqual([
      { id: "open", value: 3 },
      { id: "help", value: 2 },
    ]);

    removePage();
    expect(registry.getSnapshot()).toEqual([
      { id: "open", value: 1 },
      { id: "help", value: 2 },
    ]);

    removeGlobal();
    expect(registry.getSnapshot()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("rejects duplicate ids within one scope", () => {
    const registry = new ScopedRegistry<{ id: string }>();
    expect(() => registry.register([{ id: "same" }, { id: "same" }])).toThrow(/Duplicate/);
  });
});
