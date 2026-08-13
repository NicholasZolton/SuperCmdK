import type {
  NeedleEngine,
  NeedleExecutedCall,
  NeedleResponse,
  NeedleRunOptions,
  NeedleRunResult,
  NeedleTool,
} from "../types";

const DEFAULT_MAX_STEPS = 8;
const DEFAULT_MAX_TOKENS = 256;

function abortError(): Error {
  if (typeof DOMException !== "undefined") return new DOMException("The operation was aborted.", "AbortError");
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function jsonResult(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) return { error: value.message };
  return value;
}

function serializeResults(results: readonly unknown[]): string {
  return JSON.stringify(results, (_key, value: unknown) => jsonResult(value));
}

/** Execute Needle's function-call loop against an allowlist of registered handlers. */
export async function runNeedleChain(
  engine: NeedleEngine,
  input: string,
  tools: readonly NeedleTool[],
  options: NeedleRunOptions = {},
): Promise<NeedleRunResult> {
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const maxNewTokens = options.maxNewTokens ?? DEFAULT_MAX_TOKENS;
  const confidenceThreshold = options.confidenceThreshold ?? 0;
  const signal = options.signal ?? new AbortController().signal;

  if (!input.trim()) throw new Error("Needle input cannot be empty.");
  if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new Error("maxSteps must be a positive integer.");
  if (signal.aborted) throw abortError();

  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  await engine.initialize(
    tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
    options.systemPrompt,
  );

  let response: NeedleResponse = await engine.complete(input, maxNewTokens);
  const executed: NeedleExecutedCall[] = [];
  let steps = 0;

  while (response.type === "call" && (response.function_calls?.length ?? 0) > 0 && steps < maxSteps) {
    if (signal.aborted) throw abortError();
    if ((response.confidence ?? 1) < confidenceThreshold) break;

    steps += 1;
    const results: unknown[] = [];

    // Needle can return several calls in one turn. Keep execution sequential so side effects
    // are deterministic; chaining across turns happens after these results are fed back.
    for (const call of response.function_calls ?? []) {
      if (signal.aborted) throw abortError();
      const tool = byName.get(call.name);
      if (!tool) {
        const message = `Unknown tool: ${call.name}`;
        results.push({ error: message });
        executed.push({ call, error: message, step: steps });
        continue;
      }

      if (options.confirm && !(await options.confirm(call, tool))) {
        const message = `Tool call denied: ${call.name}`;
        results.push({ error: message });
        executed.push({ call, error: message, step: steps });
        continue;
      }

      try {
        const result = await tool.execute(call.arguments ?? {}, { signal, step: steps, input });
        results.push(result);
        executed.push({ call, result, step: steps });
      } catch (error) {
        const message = errorMessage(error);
        results.push({ error: message });
        executed.push({ call, error: message, step: steps });
      }
    }

    response = await engine.complete(serializeResults(results), maxNewTokens);
  }

  return { input, response, calls: executed, steps };
}
