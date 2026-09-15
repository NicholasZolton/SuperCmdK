import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createToolRegistry,
  connectToolRegistryToWebMcp,
  supportsWebMcp,
  type WebMcpModelContext,
  type WebMcpRegisterToolOptions,
  type WebMcpTool,
} from "../src/tools";
import type { Tool } from "../src/types";

const greet: Tool = {
  name: "greet.person",
  title: "Greet person",
  description: "Greet a person by name and return the greeting.",
  inputSchema: {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  execute: ({ name }, context) => ({ greeting: `Hello ${String(name)}`, source: context.source }),
};

function installModelContext(active: Map<string, WebMcpTool>): WebMcpModelContext {
  const modelContext: WebMcpModelContext = {
    registerTool: (tool: WebMcpTool, options?: WebMcpRegisterToolOptions): void => {
      active.set(tool.name, tool);
      options?.signal?.addEventListener("abort", () => {
        if (active.get(tool.name) === tool) active.delete(tool.name);
      }, { once: true });
    },
  };
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: modelContext,
  });
  return modelContext;
}

afterEach(() => {
  Reflect.deleteProperty(document, "modelContext");
});

describe("WebMCP bridge", () => {
  it("degrades safely when document.modelContext is unavailable", () => {
    const bridge = connectToolRegistryToWebMcp(createToolRegistry({ tools: [greet] }));

    expect(supportsWebMcp()).toBe(false);
    expect(bridge.supported).toBe(false);
    expect(() => bridge.dispose()).not.toThrow();
  });

  it("registers WebMCP-shaped tools and invokes through the shared registry", async () => {
    const active = new Map<string, WebMcpTool>();
    installModelContext(active);
    const authorize = vi.fn(() => true);
    const registry = createToolRegistry({ tools: [greet], policy: { authorize } });
    const bridge = connectToolRegistryToWebMcp(registry);
    const webTool = active.get(greet.name);

    expect(bridge.supported).toBe(true);
    expect(webTool).toMatchObject({
      name: "greet.person",
      title: "Greet person",
      inputSchema: greet.inputSchema,
      annotations: { readOnlyHint: true },
    });
    const value = await webTool?.execute(
      { name: "Ada" },
      { signal: new AbortController().signal },
    );
    expect(value).toEqual({ greeting: "Hello Ada", source: "webmcp" });
    expect(JSON.stringify(value)).toBe('{"greeting":"Hello Ada","source":"webmcp"}');
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ source: "webmcp" }),
    }));

    bridge.dispose();
    expect(active.size).toBe(0);
  });

  it("supports browser previews that omit the execution context", async () => {
    const active = new Map<string, WebMcpTool>();
    installModelContext(active);
    const registry = createToolRegistry({ tools: [greet] });
    const bridge = connectToolRegistryToWebMcp(registry);

    await expect(active.get(greet.name)?.execute({ name: "Ada" }))
      .resolves.toEqual({ greeting: "Hello Ada", source: "webmcp" });

    bridge.dispose();
  });

  it("returns actionable validation failures instead of opaque WebMCP rejections", async () => {
    const active = new Map<string, WebMcpTool>();
    installModelContext(active);
    const registry = createToolRegistry({ tools: [greet] });
    const bridge = connectToolRegistryToWebMcp(registry);

    await expect(active.get(greet.name)?.execute({ name: 42 })).resolves.toMatchObject({
      ok: false,
      invocationId: expect.stringMatching(/^tool-/),
      error: {
        code: "invalid-arguments",
        message: "Invalid arguments for tool greet.person.",
        validationIssues: [
          {
            instancePath: "/name",
            keyword: "type",
            message: "must be string",
          },
        ],
      },
    });

    bridge.dispose();
  });

  it("preserves execution error messages for WebMCP agents", async () => {
    const active = new Map<string, WebMcpTool>();
    installModelContext(active);
    const unavailable: Tool = {
      ...greet,
      execute: () => {
        throw new Error("Greeting service unavailable; retry later.");
      },
    };
    const bridge = connectToolRegistryToWebMcp(createToolRegistry({ tools: [unavailable] }));

    await expect(active.get(greet.name)?.execute({ name: "Ada" })).resolves.toMatchObject({
      ok: false,
      error: {
        code: "execution-failed",
        message: "Greeting service unavailable; retry later.",
      },
    });

    bridge.dispose();
  });

  it("preserves descriptions and emits an explicit conservative read-only hint", () => {
    const active = new Map<string, WebMcpTool>();
    installModelContext(active);
    const writeTool: Tool = {
      name: "create.note",
      description: "Create a note and return its ID and title.",
      inputSchema: { type: "object", properties: {} },
      execute: () => ({ id: "note-1", title: "New note" }),
    };

    const bridge = connectToolRegistryToWebMcp(createToolRegistry({ tools: [writeTool] }));

    expect(active.get(writeTool.name)).toMatchObject({
      description: writeTool.description,
      annotations: { readOnlyHint: false },
    });
    bridge.dispose();
  });

  it("tracks scoped overrides and restores the previous tool", async () => {
    const active = new Map<string, WebMcpTool>();
    installModelContext(active);
    const registry = createToolRegistry({ tools: [greet] });
    const bridge = connectToolRegistryToWebMcp(registry);
    const original = active.get(greet.name);
    const override: Tool = { ...greet, execute: () => "override" };
    const registration = registry.register([override]);

    expect(active.get(greet.name)).not.toBe(original);
    expect(await active.get(greet.name)?.execute(
      { name: "Ada" },
      { signal: new AbortController().signal },
    )).toBe("override");

    registration.dispose();
    expect(active.get(greet.name)).not.toBe(original);
    expect(await active.get(greet.name)?.execute(
      { name: "Ada" },
      { signal: new AbortController().signal },
    )).toEqual({ greeting: "Hello Ada", source: "webmcp" });
    bridge.dispose();
  });

  it("reports browser registration failures", async () => {
    const error = new Error("duplicate tool");
    const modelContext: WebMcpModelContext = {
      registerTool: async (): Promise<void> => Promise.reject(error),
    };
    Object.defineProperty(document, "modelContext", { configurable: true, value: modelContext });
    const onError = vi.fn();

    connectToolRegistryToWebMcp(createToolRegistry({ tools: [greet] }), { onError });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(error, greet));
  });

});
