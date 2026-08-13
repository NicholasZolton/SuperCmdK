import { createToolRegistry } from "../tools/registry";
import type { Tool } from "../tools/types";
import type {
  AgentEngine,
  AgentExecutedCall,
  AgentResponse,
  AgentRunOptions,
  AgentRunResult,
} from "../types";

const DEFAULT_MAX_STEPS = 8;
const DEFAULT_MAX_TOKENS = 256;

function abortError(): Error {
  if (typeof DOMException !== "undefined") return new DOMException("The operation was aborted.", "AbortError");
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function jsonResult(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) return { error: value.message };
  return value;
}

function serializeResults(results: readonly unknown[]): string {
  return JSON.stringify(results, (_key, value: unknown) => jsonResult(value));
}

/** Execute an Agent function-call loop against a stable snapshot of generic tools. */
export async function runAgentChain(
  engine: AgentEngine,
  input: string,
  tools: readonly Tool[],
  options: AgentRunOptions = {},
): Promise<AgentRunResult> {
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const maxNewTokens = options.maxNewTokens ?? DEFAULT_MAX_TOKENS;
  const confidenceThreshold = options.confidenceThreshold ?? 0;
  const signal = options.signal ?? new AbortController().signal;

  if (!input.trim()) throw new Error("Agent input cannot be empty.");
  if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new Error("maxSteps must be a positive integer.");
  if (signal.aborted) throw abortError();

  const registry = createToolRegistry({ tools, ...(options.toolPolicy ? { policy: options.toolPolicy } : {}) });
  await engine.initialize(
    tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
    options.systemPrompt,
  );

  let response: AgentResponse = await engine.complete(input, maxNewTokens);
  const executed: AgentExecutedCall[] = [];
  let steps = 0;

  while (response.type === "call" && (response.function_calls?.length ?? 0) > 0 && steps < maxSteps) {
    if (signal.aborted) throw abortError();
    if ((response.confidence ?? 1) < confidenceThreshold) break;

    steps += 1;
    const results: unknown[] = [];

    // Keep calls sequential so side effects are deterministic. The generic registry permits
    // concurrency for direct consumers, while this adapter owns Agent-specific ordering.
    for (const call of response.function_calls ?? []) {
      if (signal.aborted) throw abortError();
      const tool = registry.getTool(call.name);
      if (tool && options.confirm && !(await options.confirm(call, tool))) {
        const message = `Tool call denied: ${call.name}`;
        results.push({ error: message });
        executed.push({ call, error: message, step: steps });
        continue;
      }
      const invocation = await registry.invokeTool(call.name, call.arguments ?? {}, {
        source: "agent",
        signal,
        input,
        step: steps,
      });

      if (invocation.ok) {
        results.push(invocation.value);
        executed.push({ call, result: invocation.value, step: steps });
      } else {
        results.push({ error: invocation.error.message });
        executed.push({ call, error: invocation.error.message, step: steps });
      }
    }

    response = await engine.complete(serializeResults(results), maxNewTokens);
  }

  return { input, response, calls: executed, steps };
}
