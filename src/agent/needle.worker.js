/* Classic Web Worker wrapper for Cactus Needle's Emscripten artifacts. */
let moduleInstance;
let weightsPointer = 0;
let outputBufferSize = 65_536;
let queue = Promise.resolve();

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function allocateBytes(bytes, nulTerminate = false) {
  const pointer = moduleInstance._malloc(bytes.byteLength + (nulTerminate ? 1 : 0));
  if (!pointer) throw new Error(`Needle WASM could not allocate ${bytes.byteLength} bytes.`);
  moduleInstance.HEAPU8.set(bytes, pointer);
  if (nulTerminate) moduleInstance.HEAPU8[pointer + bytes.byteLength] = 0;
  return pointer;
}

function allocateString(value) {
  return allocateBytes(encoder.encode(value), true);
}

async function load({ glueUrl, wasmUrl, modelUrl, bufferSize }) {
  if (moduleInstance) return;
  outputBufferSize = bufferSize;

  const [wasmResponse, modelResponse] = await Promise.all([fetch(wasmUrl), fetch(modelUrl)]);
  if (!wasmResponse.ok) throw new Error(`Could not fetch Needle WASM (${wasmResponse.status}).`);
  if (!modelResponse.ok) throw new Error(`Could not fetch Needle model (${modelResponse.status}).`);
  const [wasmBinary, modelBinary] = await Promise.all([
    wasmResponse.arrayBuffer(),
    modelResponse.arrayBuffer(),
  ]);

  importScripts(glueUrl);
  const factory = self.createNeedle;
  if (typeof factory !== "function") {
    throw new Error("needle.js did not expose the expected createNeedle factory.");
  }
  moduleInstance = await factory({ wasmBinary });

  const weights = new Uint8Array(modelBinary);
  weightsPointer = allocateBytes(weights);
  // The current WASM ABI uses an i64 length and therefore requires a BigInt.
  const status = moduleInstance._needle_load(weightsPointer, BigInt(weights.byteLength));
  if (status !== 0) throw new Error(`needle_load failed with status ${status}.`);
  // Keep weightsPointer alive: the current engine may borrow this allocation.
}

function initialize({ tools, systemPrompt }) {
  if (!moduleInstance) throw new Error("Needle worker has not loaded.");
  const systemPointer = allocateString(systemPrompt || "");
  const toolsPointer = allocateString(JSON.stringify(tools));
  try {
    const status = moduleInstance._needle_init(systemPointer, toolsPointer, 0);
    if (status < 0) throw new Error(`needle_init failed with status ${status}.`);
  } finally {
    moduleInstance._free(systemPointer);
    moduleInstance._free(toolsPointer);
  }
}

function complete({ input, maxNewTokens }) {
  if (!moduleInstance) throw new Error("Needle worker has not loaded.");
  const inputPointer = allocateString(input);
  const outputPointer = moduleInstance._malloc(outputBufferSize);
  if (!outputPointer) {
    moduleInstance._free(inputPointer);
    throw new Error(`Needle WASM could not allocate its ${outputBufferSize}-byte output buffer.`);
  }
  moduleInstance.HEAPU8[outputPointer] = 0;

  try {
    const status = moduleInstance._needle_complete(
      inputPointer,
      maxNewTokens,
      outputPointer,
      outputBufferSize,
    );
    if (status < 0) throw new Error(`needle_complete failed with status ${status}.`);

    const heap = moduleInstance.HEAPU8;
    let end = outputPointer;
    const limit = outputPointer + outputBufferSize;
    while (end < limit && heap[end] !== 0) end += 1;
    if (end === limit) throw new Error("Needle output exceeded the configured buffer size.");
    const json = decoder.decode(heap.subarray(outputPointer, end));
    if (!json) throw new Error("Needle returned an empty response.");
    return JSON.parse(json);
  } finally {
    moduleInstance._free(inputPointer);
    moduleInstance._free(outputPointer);
  }
}

function reset() {
  if (!moduleInstance) throw new Error("Needle worker has not loaded.");
  moduleInstance._needle_reset();
}

function dispose() {
  if (moduleInstance && weightsPointer) moduleInstance._free(weightsPointer);
  weightsPointer = 0;
  moduleInstance = undefined;
  self.close();
}

async function handle(message) {
  switch (message.type) {
    case "load": return await load(message);
    case "initialize": return initialize(message);
    case "complete": return complete(message);
    case "reset": return reset();
    case "dispose": return dispose();
    default: throw new Error(`Unknown Needle worker message: ${message.type}`);
  }
}

self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      const value = await handle(data);
      self.postMessage({ id: data.id, ok: true, value });
    } catch (error) {
      self.postMessage({ id: data.id, ok: false, error: errorMessage(error) });
    }
  });
};
