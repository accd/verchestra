import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import * as cedar from "@cedar-policy/cedar-wasm/web";

import type { CedarEnginePort } from "./cedar-policy.ts";

// why: the `nodejs` build of cedar-wasm reads its WebAssembly from beside its
// own module file, which does not exist inside a sealed single-file bundle.
// The `web` build takes the bytes from the caller instead, so a sealed release
// hands it `native/cedar-wasm.wasm` (the same bytes, pinned in the release
// manifest) and a repository checkout hands it the installed package's copy.
export function createCedarEngine(wasm: Uint8Array): CedarEnginePort {
  cedar.initSync({ module: wasm });
  return cedar;
}

// invariant: only meaningful in a repository checkout, where the pinned
// package is installed; a sealed release resolves its own native component.
export function installedCedarWasmPath(): string {
  const entry = createRequire(import.meta.url).resolve("@cedar-policy/cedar-wasm/nodejs");
  return join(dirname(entry), "cedar_wasm_bg.wasm");
}
