import { describe, expect, it, vi } from "vitest";
import { createToolRegistry } from "../src/tools";
import type { Tool } from "../src/types";

const greet: Tool = {
  name: "greet",
  description: "Greet someone",
  parameters: {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
    additionalProperties: false,
  },
  execute: ({ name }, context) => ({ greeting: `Hello ${String(name)}`, source: context.source }),
};

describe("ToolRegistry", () => {
  it("supports base tools, scoped overrides, updates, and restoration", () => {
    const registry = createToolRegistry({ tools: [greet] });
    const override: Tool = { ...greet, execute: () => "override" };
    const registration = registry.register([override]);

    expect(registry.getTool("greet")).toBe(override);
    registration.update([]);
    expect(registry.getTool("greet")).toBe(greet);
    registration.update([override]);
    registration.dispose();
    expect(registry.getTool("greet")).toBe(greet);
  });

  it("restores nested policy scopes regardless of cleanup order", async () => {
    const registry = createToolRegistry({ tools: [greet], policy: { authorize: () => false } });
    const outer = registry.registerPolicy({ authorize: () => true });
    const inner = registry.registerPolicy({ authorize: () => false });
    outer.dispose();

    expect(await registry.invokeTool("greet", { name: "Ada" }))
      .toMatchObject({ ok: false, error: { code: "denied" } });
    inner.dispose();
    expect(await registry.invokeTool("greet", { name: "Ada" }))
      .toMatchObject({ ok: false, error: { code: "denied" } });
  });

  it("rejects duplicate names within one scope", () => {
    const registry = createToolRegistry();
    expect(() => registry.register([greet, greet])).toThrow(/Duplicate/);
  });
});

describe("invokeTool", () => {
  it("rejects asynchronous schemas rather than bypassing validation", async () => {
    const execute = vi.fn();
    const registry = createToolRegistry({ tools: [{
      ...greet,
      parameters: { ...greet.parameters, $async: true },
      execute,
    }] });

    const result = await registry.invokeTool("greet", {});
    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid-arguments", message: expect.stringContaining("Asynchronous JSON Schemas") },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("validates without coercion and does not execute invalid calls", async () => {
    const execute = vi.fn(greet.execute);
    const registry = createToolRegistry({ tools: [{ ...greet, execute }] });

    const result = await registry.invokeTool("greet", { name: 42 }, { source: "voice" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid-arguments");
    expect(execute).not.toHaveBeenCalled();
  });

  it("passes neutral source metadata to a valid handler", async () => {
    const registry = createToolRegistry({ tools: [greet] });
    const result = await registry.invokeTool<{ greeting: string; source: string }>(
      "greet",
      { name: "Ada" },
      { source: "voice", metadata: { transcript: "say hello to Ada" } },
    );

    expect(result).toMatchObject({ ok: true, value: { greeting: "Hello Ada", source: "voice" } });
  });

  it("authorizes every call and confirms annotated calls", async () => {
    const authorize = vi.fn(() => true);
    const confirm = vi.fn(() => false);
    const execute = vi.fn();
    const registry = createToolRegistry({
      policy: { authorize, confirm },
      tools: [{
        name: "delete_item",
        description: "Delete an item",
        parameters: { type: "object" },
        annotations: { destructive: true, requiresConfirmation: true },
        execute,
      }],
    });

    const result = await registry.invokeTool("delete_item", {}, { source: "automation" });

    expect(authorize).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ ok: false, error: { code: "denied" } });
    expect(execute).not.toHaveBeenCalled();
  });

  it("fails closed when confirmation is required but unavailable", async () => {
    const registry = createToolRegistry({ tools: [{
      ...greet,
      annotations: { requiresConfirmation: true },
    }] });

    const result = await registry.invokeTool("greet", { name: "Ada" });
    expect(result).toMatchObject({ ok: false, error: { code: "confirmation-required" } });
  });

  it("normalizes unknown, aborted, and handler failures", async () => {
    const controller = new AbortController();
    controller.abort();
    const broken: Tool = { ...greet, execute: () => { throw new Error("boom"); } };
    const registry = createToolRegistry({ tools: [broken] });

    expect(await registry.invokeTool("missing", {})).toMatchObject({ ok: false, error: { code: "unknown-tool" } });
    expect(await registry.invokeTool("greet", { name: "Ada" }, { signal: controller.signal }))
      .toMatchObject({ ok: false, error: { code: "aborted" } });
    expect(await registry.invokeTool("greet", { name: "Ada" }))
      .toMatchObject({ ok: false, error: { code: "execution-failed", message: "boom" } });
  });
});
