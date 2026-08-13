import type { ReactNode } from "react";
import type {
  JsonSchema,
  MaybePromise,
  Tool,
  ToolSchema,
} from "./tools/types";

export type {
  JsonSchema,
  MaybePromise,
  Tool,
  ToolAnnotations,
  ToolContext,
  ToolInvocationError,
  ToolInvocationErrorCode,
  ToolInvocationRequest,
  ToolInvocationResult,
  ToolInvokeOptions,
  ToolPolicy,
  ToolPolicyRegistration,
  ToolRegistration,
  ToolRegistryOptions,
  ToolResolver,
  ToolSchema,
  ToolValidationIssue,
} from "./tools/types";

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

/** @deprecated Use `ToolContext`. */
export interface AgentToolContext {
  signal: AbortSignal;
  step: number;
  input: string;
  invocationId?: string;
  source?: string;
  metadata?: Readonly<Record<string, unknown>>;
}

/** @deprecated Use `Tool`. Tools are independent of any Agent engine. */
export type AgentTool<
  TArguments extends Record<string, unknown> = Record<string, unknown>,
  TResult = unknown,
> = Tool<TArguments, TResult>;

/** @deprecated Use `ToolSchema`. */
export type AgentToolSchema = ToolSchema;

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
  /** Legacy per-call authorization. Return false to deny an individual Agent call. */
  confirm?: (call: AgentToolCall, tool: Tool) => MaybePromise<boolean>;
  /** Shared tool policy for lower-level Agent runners. The provider supplies its configured policy. */
  toolPolicy?: import("./tools/types").ToolPolicy;
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
  initialize(tools: readonly ToolSchema[], systemPrompt?: string): Promise<void>;
  complete(input: string, maxNewTokens?: number): Promise<AgentResponse>;
  reset(): Promise<void>;
  dispose(): void;
}
