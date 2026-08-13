import type {
  AgentEngine,
  AgentResponse,
  AgentToolSchema,
  NeedleWasmEngineOptions,
} from "../types";

interface WorkerSuccess {
  id: number;
  ok: true;
  value?: unknown;
}

interface WorkerFailure {
  id: number;
  ok: false;
  error: string;
}

type WorkerReply = WorkerSuccess | WorkerFailure;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

/** Browser client for the official Needle WASM artifacts. Inference stays off the UI thread. */
export class NeedleWasmEngine implements AgentEngine {
  readonly #options: NeedleWasmEngineOptions;
  readonly #worker: Worker;
  readonly #pending = new Map<number, PendingRequest>();
  #nextId = 1;
  #loaded: Promise<void> | undefined;
  #disposed = false;
  #failure: Error | undefined;

  constructor(options: NeedleWasmEngineOptions) {
    if (typeof Worker === "undefined") {
      throw new Error("NeedleWasmEngine requires a browser with Web Worker support.");
    }
    this.#options = options;
    const workerUrl = options.workerUrl ?? new URL("./needle.worker.js", import.meta.url);
    this.#worker = new Worker(workerUrl, { name: "supercmdk-needle" });
    this.#worker.onmessage = (event: MessageEvent<WorkerReply>) => this.#onMessage(event.data);
    this.#worker.onerror = (event) => this.#fail(new Error(event.message || "Needle worker failed."));
    this.#worker.onmessageerror = () => this.#fail(new Error("Needle worker sent an unreadable message."));
  }

  /** Download and compile the engine/model without initializing a tool session. */
  async preload(): Promise<void> {
    await this.#load();
  }

  async initialize(tools: readonly AgentToolSchema[], systemPrompt = ""): Promise<void> {
    await this.#load();
    await this.#request("initialize", { tools, systemPrompt });
  }

  async complete(input: string, maxNewTokens = this.#options.maxNewTokens ?? 256): Promise<AgentResponse> {
    await this.#load();
    return await this.#request<AgentResponse>("complete", { input, maxNewTokens });
  }

  async reset(): Promise<void> {
    await this.#load();
    await this.#request("reset");
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#worker.postMessage({ id: this.#nextId++, type: "dispose" });
    this.#worker.terminate();
    this.#rejectAll(new Error("NeedleWasmEngine was disposed."));
  }

  #load(): Promise<void> {
    this.#loaded ??= this.#request("load", {
      glueUrl: this.#options.glueUrl,
      wasmUrl: this.#options.wasmUrl,
      modelUrl: this.#options.modelUrl,
      bufferSize: this.#options.bufferSize ?? 65_536,
    });
    return this.#loaded;
  }

  #request<T = void>(type: string, payload?: Record<string, unknown>): Promise<T> {
    if (this.#failure) return Promise.reject(this.#failure);
    if (this.#disposed) return Promise.reject(new Error("NeedleWasmEngine was disposed."));
    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.#worker.postMessage({ id, type, ...payload });
    });
  }

  #onMessage(reply: WorkerReply): void {
    const pending = this.#pending.get(reply.id);
    if (!pending) return;
    this.#pending.delete(reply.id);
    if (reply.ok) pending.resolve(reply.value);
    else pending.reject(new Error(reply.error));
  }

  #fail(error: Error): void {
    if (this.#failure || this.#disposed) return;
    this.#failure = error;
    this.#worker.terminate();
    this.#rejectAll(error);
  }

  #rejectAll(error: Error): void {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }
}
