import { describe, expect, it, vi } from "vitest";
import { runAgentChain } from "../src/agent/run-agent-chain";
import type { AgentEngine, AgentResponse, AgentToolSchema } from "../src/types";

class FakeEngine implements AgentEngine {
  readonly inputs: string[] = [];
  readonly schemas: AgentToolSchema[][] = [];
  readonly systems: (string | undefined)[] = [];

  constructor(private readonly responses: AgentResponse[]) {}

  async initialize(tools: readonly AgentToolSchema[], systemPrompt?: string): Promise<void> {
    this.schemas.push([...tools]);
    this.systems.push(systemPrompt);
  }

  async complete(input: string): Promise<AgentResponse> {
    this.inputs.push(input);
    const response = this.responses.shift();
    if (!response) throw new Error("No fake response left");
    return response;
  }

  async reset(): Promise<void> {}
  dispose(): void {}
}

describe("runAgentChain", () => {
  it("executes and feeds results back until the Agent responds", async () => {
    const engine = new FakeEngine([
      { type: "call", confidence: 0.95, function_calls: [{ name: "find_contact", arguments: { name: "Ada" } }] },
      { type: "call", confidence: 0.9, function_calls: [{ name: "send_message", arguments: { contactId: "c1" } }] },
      { type: "respond", response: "Sent", function_calls: [] },
    ]);
    const find = vi.fn(() => ({ id: "c1" }));
    const send = vi.fn(() => ({ sent: true }));

    const result = await runAgentChain(engine, "Tell Ada hello", [
      {
        name: "find_contact",
        description: "Find a contact",
        parameters: { type: "object", properties: { name: { type: "string" } } },
        execute: find,
      },
      {
        name: "send_message",
        description: "Send a message",
        parameters: { type: "object", properties: { contactId: { type: "string" } } },
        execute: send,
      },
    ]);

    expect(find).toHaveBeenCalledWith({ name: "Ada" }, expect.objectContaining({ step: 1 }));
    expect(send).toHaveBeenCalledWith({ contactId: "c1" }, expect.objectContaining({ step: 2 }));
    expect(engine.inputs).toEqual([
      "Tell Ada hello",
      JSON.stringify([{ id: "c1" }]),
      JSON.stringify([{ sent: true }]),
    ]);
    expect(result.response.type).toBe("respond");
    expect(result.calls).toHaveLength(2);
    expect(result.steps).toBe(2);
  });

  it("does not execute low-confidence calls", async () => {
    const engine = new FakeEngine([
      { type: "call", confidence: 0.2, function_calls: [{ name: "delete_everything", arguments: {} }] },
    ]);
    const execute = vi.fn();

    const result = await runAgentChain(engine, "do it", [{
      name: "delete_everything",
      description: "Delete everything",
      parameters: { type: "object" },
      execute,
    }], { confidenceThreshold: 0.8, systemPrompt: "locale: en-US" });

    expect(engine.systems).toEqual(["locale: en-US"]);
    expect(execute).not.toHaveBeenCalled();
    expect(result.steps).toBe(0);
  });

  it("validates tool arguments through the generic invocation path", async () => {
    const engine = new FakeEngine([
      { type: "call", function_calls: [{ name: "send", arguments: { count: "two" } }] },
      { type: "respond", function_calls: [] },
    ]);
    const execute = vi.fn();

    const result = await runAgentChain(engine, "send it", [{
      name: "send",
      description: "Send items",
      parameters: {
        type: "object",
        properties: { count: { type: "number" } },
        required: ["count"],
      },
      execute,
    }]);

    expect(execute).not.toHaveBeenCalled();
    expect(JSON.parse(engine.inputs[1] ?? "[]")).toEqual([{ error: "Invalid arguments for tool send." }]);
    expect(result.calls[0]?.error).toBe("Invalid arguments for tool send.");
  });

  it("preserves legacy confirm rejection behavior", async () => {
    const engine = new FakeEngine([
      { type: "call", function_calls: [{ name: "known", arguments: {} }] },
    ]);

    await expect(runAgentChain(engine, "run", [{
      name: "known",
      description: "Known tool",
      parameters: { type: "object" },
      execute: () => undefined,
    }], { confirm: async () => { throw new Error("confirmation failed"); } }))
      .rejects.toThrow("confirmation failed");
  });

  it("applies shared tool policy to Agent calls", async () => {
    const engine = new FakeEngine([
      { type: "call", function_calls: [{ name: "delete_item", arguments: {} }] },
      { type: "respond", function_calls: [] },
    ]);
    const execute = vi.fn();

    const result = await runAgentChain(engine, "delete it", [{
      name: "delete_item",
      description: "Delete an item",
      parameters: { type: "object" },
      annotations: { requiresConfirmation: true },
      execute,
    }], { toolPolicy: { confirm: () => false } });

    expect(execute).not.toHaveBeenCalled();
    expect(result.calls[0]?.error).toBe("Tool call denied: delete_item");
  });

  it("returns tool errors to the Agent rather than escaping the chain", async () => {
    const engine = new FakeEngine([
      { type: "call", function_calls: [{ name: "known", arguments: {} }, { name: "missing", arguments: {} }] },
      { type: "respond", function_calls: [] },
    ]);

    const result = await runAgentChain(engine, "run", [{
      name: "known",
      description: "Known tool",
      parameters: { type: "object" },
      execute: () => { throw new Error("handler failed"); },
    }]);

    expect(JSON.parse(engine.inputs[1] ?? "[]")).toEqual([
      { error: "handler failed" },
      { error: "Unknown tool: missing" },
    ]);
    expect(result.calls.map((call) => call.error)).toEqual(["handler failed", "Unknown tool: missing"]);
  });
});
