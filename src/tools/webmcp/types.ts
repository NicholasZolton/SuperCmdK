import type {
  JsonSchema,
  MaybePromise,
  ToolAnnotations,
  ToolInvocationError,
} from "../types";

export interface WebMcpExecuteOptions {
  signal: AbortSignal;
}

/** Serializable failure returned because WebMCP currently discards rejected promise details. */
export interface WebMcpToolFailure {
  ok: false;
  invocationId: string;
  error: ToolInvocationError;
}

/** The browser-facing tool shape defined by the WebMCP imperative API. */
export interface WebMcpTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: ToolAnnotations;
  execute: (
    arguments_: Record<string, unknown>,
    options?: WebMcpExecuteOptions,
  ) => MaybePromise<unknown>;
}

export interface WebMcpRegisterToolOptions {
  signal?: AbortSignal;
}

/** The subset of Document.modelContext used by SuperCmdK. */
export interface WebMcpModelContext {
  registerTool(tool: WebMcpTool, options?: WebMcpRegisterToolOptions): MaybePromise<void>;
}
