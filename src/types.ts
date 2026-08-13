import type { ReactNode } from "react";

export type MaybePromise<T> = T | Promise<T>;

/** The JSON Schema subset accepted by the Agent engine. Extra JSON Schema keys are allowed. */
export interface JsonSchema {
  type?: string | readonly string[];
  description?: string;
  properties?: Readonly<Record<string, JsonSchema>>;
  required?: readonly string[];
  items?: JsonSchema | readonly JsonSchema[];
  enum?: readonly unknown[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  format?: string;
  additionalProperties?: boolean | JsonSchema;
  [keyword: string]: unknown;
}

export interface CommandExecutionContext {
  query: string;
  close: () => void;
  runAgent: (input: string, options?: AgentRunOptions) => Promise<AgentRunResult>;
}

export interface CommandChoice {
  /** Stable identifier. A page-scoped command overrides a global command with the same id. */
  id: string;
  label: string;
  description?: string;
  group?: string;
  keywords?: readonly string[];
  shortcut?: readonly string[] | string;
  icon?: ReactNode;
  disabled?: boolean;
  priority?: number;
  closeOnSelect?: boolean;
  run: (context: CommandExecutionContext) => MaybePromise<void>;
}

export interface AgentToolCall {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface AgentResponse {
  type: "call" | "respond" | string;
  success?: boolean;
  error?: string | null;
  error_code?: string | null;
  function_calls?: readonly AgentToolCall[];
  reasoning?: string;
  response?: string;
  confidence?: number;
  [key: string]: unknown;
}

export interface AgentToolContext {
  signal: AbortSignal;
  step: number;
  input: string;
}

export interface AgentTool<TArguments extends Record<string, unknown> = Record<string, unknown>, TResult = unknown> {
  /** Must be unique and should contain only letters, numbers, underscores, or hyphens. */
  name: string;
  description: string;
  parameters: JsonSchema;
  execute: (arguments_: TArguments, context: AgentToolContext) => MaybePromise<TResult>;
}

export interface AgentToolSchema {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface AgentExecutedCall {
  call: AgentToolCall;
  result?: unknown;
  error?: string;
  step: number;
}

export interface AgentRunResult {
  input: string;
  response: AgentResponse;
  calls: readonly AgentExecutedCall[];
  steps: number;
}

export interface AgentRunOptions {
  maxSteps?: number;
  maxNewTokens?: number;
  /** Calls below this confidence are returned but not executed. Defaults to 0. */
  confidenceThreshold?: number;
  /** Override the Agent engine's system facts for this run. */
  systemPrompt?: string;
  signal?: AbortSignal;
  /** Return false to deny an individual call before its handler runs. */
  confirm?: (call: AgentToolCall, tool: AgentTool) => MaybePromise<boolean>;
}

export interface AgentOptions {
  /** Engine instance or lazy factory. Factories keep vendor adapters out of the initial bundle. */
  engine: AgentEngine | (() => MaybePromise<AgentEngine>);
  /** System facts supplied whenever an Agent run initializes its tools. */
  systemPrompt?: string | (() => string);
  /** Warm the engine after page load during idle time. Defaults to true. */
  preload?: boolean;
}

/** Configuration for the built-in Cactus Needle WASM engine adapter. */
export interface NeedleWasmEngineOptions {
  /** URL of the official Emscripten `needle.js` artifact. */
  glueUrl: string;
  /** URL of the matching `needle.wasm` artifact. */
  wasmUrl: string;
  /** URL of the matching `needle2.cact` model. */
  modelUrl: string;
  /** Override the library's bundled classic worker. */
  workerUrl?: string | URL;
  bufferSize?: number;
  maxNewTokens?: number;
}

export interface AgentEngine {
  initialize(tools: readonly AgentToolSchema[], systemPrompt?: string): Promise<void>;
  complete(input: string, maxNewTokens?: number): Promise<AgentResponse>;
  reset(): Promise<void>;
  dispose(): void;
}
