import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NeedleWasmEngine } from "../src/agent/needle-wasm-engine";

class WorkerMock {
  static latest: WorkerMock;
  readonly messages: unknown[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;

  constructor() {
    WorkerMock.latest = this;
  }

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  fail(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

const originalWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");

beforeEach(() => {
  Object.defineProperty(globalThis, "Worker", { configurable: true, writable: true, value: WorkerMock });
});

afterEach(() => {
  if (originalWorker) Object.defineProperty(globalThis, "Worker", originalWorker);
  else Reflect.deleteProperty(globalThis, "Worker");
});

describe("NeedleWasmEngine", () => {
  it("rejects current and future requests after a worker runtime failure", async () => {
    const client = new NeedleWasmEngine({
      glueUrl: "/needle/needle.js",
      wasmUrl: "/needle/needle.wasm",
      modelUrl: "/needle/needle2.cact",
    });

    const current = client.complete("hello");
    const worker = WorkerMock.latest;
    expect(worker.messages).toHaveLength(1);
    worker.fail("worker exploded");

    await expect(current).rejects.toThrow("worker exploded");
    await expect(client.complete("again")).rejects.toThrow("worker exploded");
    expect(worker.terminated).toBe(true);
    client.dispose();
  });
});
