import type {
  Tool,
  ToolInvocationError,
  ToolInvocationEvent,
  ToolInvocationListener,
  ToolInvocationResult,
  ToolInvokeOptions,
  ToolResolver,
  ToolValidationIssue,
} from "./types";

let invocationSequence = 0;
let ajvPromise: Promise<import("ajv").default> | undefined;
const validators = new WeakMap<object, import("ajv").ValidateFunction>();

function nextInvocationId(): string {
  invocationSequence += 1;
  return `tool-${Date.now().toString(36)}-${invocationSequence.toString(36)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failure<TResult>(
  invocationId: string,
  error: ToolInvocationError,
  tool?: Tool,
): ToolInvocationResult<TResult> {
  return { ok: false, invocationId, error, ...(tool ? { tool } : {}) };
}

function aborted<TResult>(invocationId: string, tool?: Tool): ToolInvocationResult<TResult> {
  return failure(invocationId, { code: "aborted", message: "Tool invocation was aborted." }, tool);
}

/** Notify an observer without allowing observer failures to change tool execution. */
export function notifyInvocation(listener: ToolInvocationListener | undefined, event: ToolInvocationEvent): void {
  if (!listener) return;
  try {
    listener(event);
  } catch {
    // Invocation observers are isolated from the operation they report.
  }
}

function finishInvocation<TResult>(
  result: ToolInvocationResult<TResult>,
  tool: Tool,
  source: string,
  listener: ToolInvocationListener | undefined,
): ToolInvocationResult<TResult> {
  if (result.ok) {
    notifyInvocation(listener, { phase: "succeeded", invocationId: result.invocationId, tool, source });
    return result;
  }
  const phase = result.error.code === "aborted"
    ? "aborted"
    : result.error.code === "denied" || result.error.code === "confirmation-required"
      ? "denied"
      : "failed";
  notifyInvocation(listener, {
    phase,
    invocationId: result.invocationId,
    tool,
    source,
    error: result.error,
  });
  return result;
}

async function validateArguments(tool: Tool, arguments_: unknown): Promise<readonly ToolValidationIssue[]> {
  let validate = validators.get(tool.inputSchema);
  if (!validate) {
    ajvPromise ??= import("ajv").then(({ default: Ajv }) => new Ajv({
      allErrors: true,
      strict: false,
      coerceTypes: false,
      useDefaults: false,
      removeAdditional: false,
    }));
    if (tool.inputSchema.$async === true) throw new Error("Asynchronous JSON Schemas are not supported.");
    validate = (await ajvPromise).compile(tool.inputSchema as object);
    validators.set(tool.inputSchema, validate);
  }
  if (validate(arguments_)) return [];
  return (validate.errors ?? []).map((issue) => ({
    instancePath: issue.instancePath,
    schemaPath: issue.schemaPath,
    keyword: issue.keyword,
    ...(issue.message ? { message: issue.message } : {}),
    params: issue.params as Record<string, unknown>,
  }));
}

/** Resolve, validate, authorize, confirm, and execute one registered tool. */
export async function invokeTool<TResult = unknown>(
  resolver: ToolResolver,
  name: string,
  arguments_: unknown,
  options: ToolInvokeOptions = {},
): Promise<ToolInvocationResult<TResult>> {
  const invocationId = nextInvocationId();
  const tool = resolver.getTool(name);
  if (!tool) return failure(invocationId, { code: "unknown-tool", message: `Unknown tool: ${name}` });

  const signal = options.signal ?? new AbortController().signal;
  const source = options.source ?? "application";
  const context = {
    signal,
    invocationId,
    source,
    ...(options.metadata ? { metadata: options.metadata } : {}),
    input: options.input ?? "",
    step: options.step ?? 1,
  };
  const finish = (result: ToolInvocationResult<TResult>): ToolInvocationResult<TResult> =>
    finishInvocation(result, tool, source, options.onInvocation);
  notifyInvocation(options.onInvocation, { phase: "started", invocationId, tool, source });

  if (signal.aborted) return finish(aborted(invocationId, tool));

  if (!arguments_ || typeof arguments_ !== "object" || Array.isArray(arguments_)) {
    return finish(failure(invocationId, {
      code: "invalid-arguments",
      message: `Invalid arguments for tool ${name}.`,
      validationIssues: [{
        instancePath: "",
        schemaPath: "#/type",
        keyword: "type",
        message: "must be an object",
        params: { type: "object" },
      }],
    }, tool));
  }

  let issues: readonly ToolValidationIssue[];
  try {
    issues = await validateArguments(tool, arguments_);
  } catch (error) {
    return finish(failure(invocationId, {
      code: "invalid-arguments",
      message: `Invalid parameter schema for tool ${name}: ${errorMessage(error)}`,
    }, tool));
  }
  if (signal.aborted) return finish(aborted(invocationId, tool));
  if (issues.length > 0) {
    return finish(failure(invocationId, {
      code: "invalid-arguments",
      message: `Invalid arguments for tool ${name}.`,
      validationIssues: issues,
    }, tool));
  }

  const request = { tool, arguments: arguments_ as Record<string, unknown>, context };

  try {
    const policy = resolver.getPolicy?.();
    const authorize = policy?.authorize;
    if (authorize && !(await authorize(request))) {
      return finish(failure(invocationId, { code: "denied", message: `Tool call denied: ${name}` }, tool));
    }
    if (signal.aborted) return finish(aborted(invocationId, tool));
    if (options.authorize && !(await options.authorize(request))) {
      return finish(failure(invocationId, { code: "denied", message: `Tool call denied: ${name}` }, tool));
    }
    if (signal.aborted) return finish(aborted(invocationId, tool));

    if (tool.annotations?.consequentialHint) {
      const confirm = policy?.confirm;
      if (!confirm) {
        return finish(failure(invocationId, {
          code: "confirmation-required",
          message: `Tool requires confirmation: ${name}`,
        }, tool));
      }
      if (!(await confirm(request))) {
        return finish(failure(invocationId, { code: "denied", message: `Tool call denied: ${name}` }, tool));
      }
    }
    if (signal.aborted) return finish(aborted(invocationId, tool));

    const value = await tool.execute(request.arguments, context) as TResult;
    if (signal.aborted) return finish(aborted(invocationId, tool));
    return finish({ ok: true, invocationId, tool, value });
  } catch (error) {
    if (signal.aborted) return finish(aborted(invocationId, tool));
    return finish(failure(invocationId, { code: "execution-failed", message: errorMessage(error) }, tool));
  }
}
