import type { ToolRegistry } from "../registry";
import type { Tool } from "../types";
import type { WebMcpModelContext, WebMcpTool } from "./types";

interface ActiveRegistration {
  tool: Tool;
  controller: AbortController;
}

export interface WebMcpBridgeOptions {
  /** Receives asynchronous browser registration failures. */
  onError?: (error: Error, tool: Tool) => void;
}

export interface WebMcpBridge {
  /** Whether a compatible document.modelContext was present when connected. */
  readonly supported: boolean;
  dispose(): void;
}

function isWebMcpModelContext(value: unknown): value is WebMcpModelContext {
  return typeof value === "object"
    && value !== null
    && "registerTool" in value
    && typeof value.registerTool === "function";
}

function currentDocument(): unknown {
  return typeof document === "undefined" ? undefined : document;
}

function getModelContext(document_: unknown): WebMcpModelContext | undefined {
  if (
    typeof document_ !== "object"
    || document_ === null
    || !("modelContext" in document_)
  ) return undefined;
  return isWebMcpModelContext(document_.modelContext) ? document_.modelContext : undefined;
}

function normalizedError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) return { error: value.message };
  return value;
}

/** Serialize a generic tool result into the string returned by WebMCP handlers. */
export function serializeWebMcpResult(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return JSON.stringify(value, jsonReplacer) ?? String(value);
}

/** Project one canonical SuperCmdK tool into the WebMCP imperative tool shape. */
export function toWebMcpTool(tool: Tool, registry: ToolRegistry): WebMcpTool {
  return {
    name: tool.name,
    ...(tool.title === undefined ? {} : { title: tool.title }),
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: {
      ...tool.annotations,
      readOnlyHint: tool.annotations?.readOnlyHint ?? false,
    },
    execute: async (arguments_, { signal }): Promise<string> => {
      const result = await registry.invokeTool(tool.name, arguments_, {
        source: "webmcp",
        signal,
      });
      if (!result.ok) throw new Error(result.error.message);
      return serializeWebMcpResult(result.value);
    },
  };
}

/** Keep a registry's active tools synchronized with Document.modelContext. */
export function connectToolRegistryToWebMcp(
  registry: ToolRegistry,
  options: WebMcpBridgeOptions = {},
): WebMcpBridge {
  const modelContext = getModelContext(currentDocument());
  if (!modelContext) return { supported: false, dispose: (): void => undefined };

  const registrations = new Map<string, ActiveRegistration>();
  let disposed = false;

  const reportError = (error: unknown, tool: Tool): void => {
    const normalized = normalizedError(error);
    if (options.onError) options.onError(normalized, tool);
    else console.error(`[SuperCmdK] Could not register WebMCP tool ${tool.name}.`, normalized);
  };

  const unregister = (name: string): void => {
    const registration = registrations.get(name);
    if (!registration) return;
    registrations.delete(name);
    registration.controller.abort();
  };

  const synchronize = (): void => {
    if (disposed) return;
    const tools = registry.getSnapshot();
    const nextTools = new Map(tools.map((tool) => [tool.name, tool]));

    for (const [name, registration] of registrations) {
      if (nextTools.get(name) !== registration.tool) unregister(name);
    }

    for (const tool of tools) {
      if (registrations.has(tool.name)) continue;
      const controller = new AbortController();
      registrations.set(tool.name, { tool, controller });
      try {
        void Promise.resolve(
          modelContext.registerTool(toWebMcpTool(tool, registry), { signal: controller.signal }),
        ).catch((error: unknown) => {
          if (!controller.signal.aborted) reportError(error, tool);
        });
      } catch (error) {
        if (!controller.signal.aborted) reportError(error, tool);
      }
    }
  };

  const unsubscribe = registry.subscribe(synchronize);
  synchronize();

  return {
    supported: true,
    dispose: (): void => {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      for (const name of [...registrations.keys()]) unregister(name);
    },
  };
}

/** Detect support without registering any tools. */
export function supportsWebMcp(): boolean {
  return getModelContext(currentDocument()) !== undefined;
}
