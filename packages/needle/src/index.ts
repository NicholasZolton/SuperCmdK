import {
  NeedleWasmEngine,
  type NeedleWasmEngineOptions,
} from "@supercmdk/react/agent";

export const NEEDLE_REVISION = "07f3e789e993e8ecf69ef5409fd7558f5fe43202";

/** URLs for the Apache-2.0 Needle artifacts bundled with this package. */
export const needleAssetUrls = Object.freeze({
  glueUrl: new URL("../assets/needle.js", import.meta.url).href,
  wasmUrl: new URL("../assets/needle.wasm", import.meta.url).href,
  modelUrl: new URL("../assets/needle2.cact", import.meta.url).href,
});

export type BundledNeedleEngineOptions = Omit<
  NeedleWasmEngineOptions,
  "glueUrl" | "wasmUrl" | "modelUrl"
>;

/** Create a Needle engine backed by the model and WASM bundled in this package. */
export function createNeedleEngine(
  options: BundledNeedleEngineOptions = {},
): NeedleWasmEngine {
  return new NeedleWasmEngine({
    ...needleAssetUrls,
    ...options,
  });
}

export { NeedleWasmEngine } from "@supercmdk/react/agent";
export type { NeedleWasmEngineOptions } from "@supercmdk/react/agent";
