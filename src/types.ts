import type { ReactNode } from "react";

export type MaybePromise<T> = T | Promise<T>;

/** The JSON Schema subset accepted by Needle. Extra JSON Schema keys are allowed. */
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
  runNeedle: (input: string, options?: NeedleRunOptions) => Promise<NeedleRunResult>;
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

export interface NeedleToolCall {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface NeedleResponse {
  type: "call" | "respond" | string;
  success?: boolean;
  error?: string | null;
  error_code?: string | null;
  function_calls?: readonly NeedleToolCall[];
  reasoning?: string;
  response?: string;
  confidence?: number;
  [key: string]: unknown;
}

export interface NeedleToolContext {
  signal: AbortSignal;
  step: number;
  input: string;
}

export interface NeedleTool<TArguments extends Record<string, unknown> = Record<string, unknown>, TResult = unknown> {
  /** Must be unique and should contain only letters, numbers, underscores, or hyphens. */
  name: string;
  description: string;
  parameters: JsonSchema;
  execute: (arguments_: TArguments, context: NeedleToolContext) => MaybePromise<TResult>;
}

export interface NeedleToolSchema {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface NeedleExecutedCall {
  call: NeedleToolCall;
  result?: unknown;
  error?: string;
  step: number;
}

export interface NeedleRunResult {
  input: string;
  response: NeedleResponse;
  calls: readonly NeedleExecutedCall[];
  steps: number;
}

export interface NeedleRunOptions {
  maxSteps?: number;
  maxNewTokens?: number;
  /** Calls below this confidence are returned but not executed. Defaults to 0. */
  confidenceThreshold?: number;
  /** Override Needle's system facts for this run. */
  systemPrompt?: string;
  signal?: AbortSignal;
  /** Return false to deny an individual call before its handler runs. */
  confirm?: (call: NeedleToolCall, tool: NeedleTool) => MaybePromise<boolean>;
}

export interface NeedleWasmOptions {
  /** URL of the official Emscripten `needle.js` artifact. */
  glueUrl: string;
  /** URL of the matching `needle.wasm` artifact. */
  wasmUrl: string;
  /** URL of the matching `needle2.cact` model. */
  modelUrl: string;
  /** Override the library's bundled classic worker. */
  workerUrl?: string | URL;
  /** Needle system facts, such as `date: ...; locale: en-US`. */
  systemPrompt?: string | (() => string);
  /** Warm the Worker, WASM, and model after page load during idle time. Defaults to true. */
  preload?: boolean;
  bufferSize?: number;
  maxNewTokens?: number;
}

export interface NeedleEngine {
  initialize(tools: readonly NeedleToolSchema[], systemPrompt?: string): Promise<void>;
  complete(input: string, maxNewTokens?: number): Promise<NeedleResponse>;
  reset(): Promise<void>;
  dispose(): void;
}
