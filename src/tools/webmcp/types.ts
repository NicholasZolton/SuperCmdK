import type { JsonSchema, MaybePromise, ToolAnnotations } from "../types";

export interface WebMcpExecuteOptions {
  signal: AbortSignal;
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
    options: WebMcpExecuteOptions,
  ) => MaybePromise<string>;
}

export interface WebMcpRegisterToolOptions {
  signal?: AbortSignal;
}

/** The subset of Document.modelContext used by SuperCmdK. */
export interface WebMcpModelContext {
  registerTool(tool: WebMcpTool, options?: WebMcpRegisterToolOptions): MaybePromise<void>;
}
