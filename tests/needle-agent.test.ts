import { describe, expect, it, vi } from "vitest";
import { runNeedleChain } from "../src/needle/agent";
import type { NeedleEngine, NeedleResponse, NeedleToolSchema } from "../src/types";

class FakeEngine implements NeedleEngine {
  readonly inputs: string[] = [];
  readonly schemas: NeedleToolSchema[][] = [];
  readonly systems: (string | undefined)[] = [];

  constructor(private readonly responses: NeedleResponse[]) {}

  async initialize(tools: readonly NeedleToolSchema[], systemPrompt?: string): Promise<void> {
    this.schemas.push([...tools]);
    this.systems.push(systemPrompt);
  }

  async complete(input: string): Promise<NeedleResponse> {
    this.inputs.push(input);
    const response = this.responses.shift();
    if (!response) throw new Error("No fake response left");
    return response;
  }

  async reset(): Promise<void> {}
  dispose(): void {}
}

describe("runNeedleChain", () => {
  it("executes and feeds results back until Needle responds", async () => {
    const engine = new FakeEngine([
      { type: "call", confidence: 0.95, function_calls: [{ name: "find_contact", arguments: { name: "Ada" } }] },
      { type: "call", confidence: 0.9, function_calls: [{ name: "send_message", arguments: { contactId: "c1" } }] },
      { type: "respond", response: "Sent", function_calls: [] },
    ]);
    const find = vi.fn(() => ({ id: "c1" }));
    const send = vi.fn(() => ({ sent: true }));

    const result = await runNeedleChain(engine, "Tell Ada hello", [
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

    const result = await runNeedleChain(engine, "do it", [{
      name: "delete_everything",
      description: "Delete everything",
      parameters: { type: "object" },
      execute,
    }], { confidenceThreshold: 0.8, systemPrompt: "locale: en-US" });

    expect(engine.systems).toEqual(["locale: en-US"]);
    expect(execute).not.toHaveBeenCalled();
    expect(result.steps).toBe(0);
  });

  it("returns tool errors to Needle rather than escaping the chain", async () => {
    const engine = new FakeEngine([
      { type: "call", function_calls: [{ name: "known", arguments: {} }, { name: "missing", arguments: {} }] },
      { type: "respond", function_calls: [] },
    ]);

    const result = await runNeedleChain(engine, "run", [{
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
