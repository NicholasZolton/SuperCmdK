import type { ToolRegistry } from "../registry";
import type { Tool, ToolInvocationError, ToolValidationIssue } from "../types";
import type { WebMcpModelContext, WebMcpTool, WebMcpToolFailure } from "./types";

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

function compactValidationIssues(
  issues: readonly ToolValidationIssue[],
): readonly ToolValidationIssue[] {
  const collapsedOneOfIssues = issues.filter((issue): boolean => {
    if (issue.keyword !== "oneOf") return false;
    const branchPrefix = `${issue.schemaPath}/`;
    const constBranchCount = issues.filter(
      (candidate): boolean => candidate.keyword === "const"
        && candidate.instancePath === issue.instancePath
        && candidate.schemaPath.startsWith(branchPrefix),
    ).length;
    return constBranchCount > 1;
  });
  if (collapsedOneOfIssues.length === 0) return issues;

  const collapsedPrefixes = collapsedOneOfIssues.map(
    (issue): { instancePath: string; schemaPath: string; branchPrefix: string; optionCount: number } => ({
      instancePath: issue.instancePath,
      schemaPath: issue.schemaPath,
      branchPrefix: `${issue.schemaPath}/`,
      optionCount: issues.filter(
        (candidate): boolean => candidate.keyword === "const"
          && candidate.instancePath === issue.instancePath
          && candidate.schemaPath.startsWith(`${issue.schemaPath}/`),
      ).length,
    }),
  );

  return issues.flatMap((issue): readonly ToolValidationIssue[] => {
    const collapsed = collapsedPrefixes.find(
      (candidate): boolean => candidate.instancePath === issue.instancePath
        && (issue.schemaPath === candidate.schemaPath
          || (issue.keyword === "const" && issue.schemaPath.startsWith(candidate.branchPrefix))),
    );
    if (!collapsed) return [issue];
    if (issue.keyword === "const") return [];
    return [{
      ...issue,
      message: `must match one of ${collapsed.optionCount} advertised values`,
      params: { optionCount: collapsed.optionCount },
    }];
  });
}

function compactError(error: ToolInvocationError): ToolInvocationError {
  if (!error.validationIssues) return error;
  return { ...error, validationIssues: compactValidationIssues(error.validationIssues) };
}

function failureText(error: ToolInvocationError): string {
  const firstIssue = error.validationIssues?.[0];
  if (!firstIssue?.message) return `[${error.code}] ${error.message}`;
  const location = firstIssue.instancePath || "Arguments";
  return `[${error.code}] ${error.message} ${location} ${firstIssue.message}.`;
}

function webMcpFailure(
  invocationId: string,
  error: ToolInvocationError,
): WebMcpToolFailure {
  const compactedError = compactError(error);
  return {
    isError: true,
    content: [{ type: "text", text: failureText(compactedError) }],
    structuredContent: { ok: false, invocationId, error: compactedError },
  };
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
    execute: async (arguments_, options): Promise<unknown> => {
      // Some WebMCP previews omit execution options; cancellation remains available when supplied.
      const signal = options?.signal ?? new AbortController().signal;
      const result = await registry.invokeTool(tool.name, arguments_, {
        source: "webmcp",
        signal,
      });
      // The current WebMCP draft discards promise rejection reasons. Resolve a
      // structured failure so agents receive enough detail to correct or retry.
      if (!result.ok) return webMcpFailure(result.invocationId, result.error);
      return result.value;
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
