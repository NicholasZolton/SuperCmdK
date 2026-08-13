import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  NEEDLE_REVISION,
  createNeedleEngine,
  needleAssetUrls,
} from "../src";

class WorkerMock {
  static latest: WorkerMock;
  readonly messages: unknown[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;

  constructor() {
    WorkerMock.latest = this;
  }

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  terminate(): void {}
}

const originalWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");

beforeEach(() => {
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    writable: true,
    value: WorkerMock,
  });
});

afterEach(() => {
  if (originalWorker) Object.defineProperty(globalThis, "Worker", originalWorker);
  else Reflect.deleteProperty(globalThis, "Worker");
});

describe("@supercmdk/needle", () => {
  it("creates an engine with package-relative bundled assets", async () => {
    const engine = createNeedleEngine();
    const preload = engine.preload();

    expect(NEEDLE_REVISION).toHaveLength(40);
    expect(needleAssetUrls.glueUrl).toMatch(/assets\/needle\.js$/);
    expect(needleAssetUrls.wasmUrl).toMatch(/assets\/needle\.wasm$/);
    expect(needleAssetUrls.modelUrl).toMatch(/assets\/needle2\.cact$/);
    expect(WorkerMock.latest.messages[0]).toMatchObject({
      type: "load",
      glueUrl: needleAssetUrls.glueUrl,
      wasmUrl: needleAssetUrls.wasmUrl,
      modelUrl: needleAssetUrls.modelUrl,
    });

    const loadMessage = WorkerMock.latest.messages[0] as { id: number };
    WorkerMock.latest.onmessage?.({
      data: { id: loadMessage.id, ok: true },
    } as MessageEvent);
    await preload;
    engine.dispose();
  });
});
