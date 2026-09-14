export type MaybePromise<T> = T | Promise<T>;

/** The JSON Schema subset used for tool arguments. Extra JSON Schema keys are allowed. */
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

export interface ToolAnnotations {
  /** The tool does not modify application or external state. */
  readOnlyHint?: boolean;
  /** The tool may return user-generated or otherwise untrusted content. */
  untrustedContentHint?: boolean;
  /** The tool has significant real-world or non-reversible effects. */
  consequentialHint?: boolean;
}

export interface ToolContext {
  signal: AbortSignal;
  invocationId: string;
  /** Adapter-defined origin such as `agent`, `voice`, `accessibility`, or `automation`. */
  source: string;
  /** Adapter metadata is context, not an authenticated identity. */
  metadata?: Readonly<Record<string, unknown>>;
  /** Original natural-language input when available. Kept for AgentTool compatibility. */
  input: string;
  /** Chain step when available, otherwise 1. Kept for AgentTool compatibility. */
  step: number;
}

export interface Tool<TArguments extends Record<string, unknown> = Record<string, unknown>, TResult = unknown> {
  /** WebMCP-compatible identifier: 1-128 letters, numbers, underscores, hyphens, or periods. */
  name: string;
  /** Optional human-readable label for interfaces that display the tool. */
  title?: string;
  /** Explain when to use the tool and what a successful call returns. */
  description: string;
  inputSchema: JsonSchema;
  annotations?: ToolAnnotations;
  execute: (arguments_: TArguments, context: ToolContext) => MaybePromise<TResult>;
}

export interface ToolSchema {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: ToolAnnotations;
}

export interface ToolValidationIssue {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message?: string;
  params: Readonly<Record<string, unknown>>;
}

export type ToolInvocationErrorCode =
  | "unknown-tool"
  | "invalid-arguments"
  | "denied"
  | "confirmation-required"
  | "aborted"
  | "execution-failed";

export interface ToolInvocationError {
  code: ToolInvocationErrorCode;
  message: string;
  validationIssues?: readonly ToolValidationIssue[];
}

interface ToolInvocationEventBase {
  invocationId: string;
  tool: Tool;
  source: string;
}

export type ToolInvocationEvent =
  | (ToolInvocationEventBase & { phase: "started" | "succeeded" })
  | (ToolInvocationEventBase & {
    phase: "failed" | "denied" | "aborted";
    error: ToolInvocationError;
  });

export type ToolInvocationListener = (event: ToolInvocationEvent) => void;

export interface ToolInvocationRequest {
  tool: Tool;
  arguments: Record<string, unknown>;
  context: ToolContext;
}

export interface ToolPolicy {
  /** Authorization runs for every invocation. Return false to deny it. */
  authorize?: (request: ToolInvocationRequest) => MaybePromise<boolean>;
  /** Called for tools marked `consequentialHint`. Missing confirmation denies safely. */
  confirm?: (request: ToolInvocationRequest) => MaybePromise<boolean>;
}

export interface ToolInvokeOptions {
  source?: string;
  signal?: AbortSignal;
  metadata?: Readonly<Record<string, unknown>>;
  input?: string;
  step?: number;
  /** Additional invocation-specific authorization, after the registry policy. */
  authorize?: (request: ToolInvocationRequest) => MaybePromise<boolean>;
  /** Observe this invocation without changing its result. Arguments and return values are omitted. */
  onInvocation?: ToolInvocationListener;
}

export type ToolInvocationResult<TResult = unknown> =
  | { ok: true; tool: Tool; value: TResult; invocationId: string }
  | { ok: false; tool?: Tool; error: ToolInvocationError; invocationId: string };

export interface ToolResolver {
  getSnapshot(): readonly Tool[];
  getTool(name: string): Tool | undefined;
  getPolicy?(): ToolPolicy | undefined;
}

export interface ToolRegistration {
  update(tools: readonly Tool[]): void;
  dispose(): void;
}

export interface ToolPolicyRegistration {
  update(policy: ToolPolicy): void;
  dispose(): void;
}

export interface ToolRegistryOptions {
  tools?: readonly Tool[];
  policy?: ToolPolicy;
}
