import { createHash } from "node:crypto";

import {
  MAXIMUM_EXECUTION_PAYLOAD_BYTES,
  executionPayloadDigest,
  type ExecutionPayloadStore
} from "@verchestra/application";

export class ExecutionPayloadStoreError extends Error {
  readonly code: "VES_PAYLOAD_TOO_LARGE" | "VES_PAYLOAD_STORE_FULL";

  constructor(code: ExecutionPayloadStoreError["code"], message: string) {
    super(message);
    this.name = "ExecutionPayloadStoreError";
    this.code = code;
  }
}

// Process-local, content-addressed payloads for one run. The bridge controller
// puts tool content here; the worktree tool adapter resolves and re-hashes it.
// Bounded so a model cannot grow controller memory without limit.
export class InMemoryExecutionPayloadStore implements ExecutionPayloadStore {
  readonly #entries = new Map<string, Uint8Array>();
  readonly #maximumTotalBytes: number;
  #totalBytes = 0;

  constructor(options: { readonly maximumTotalBytes?: number } = {}) {
    this.#maximumTotalBytes = options.maximumTotalBytes ?? 64 * 1024 * 1024;
  }

  async put(content: Uint8Array): Promise<string> {
    if (content.byteLength > MAXIMUM_EXECUTION_PAYLOAD_BYTES)
      throw new ExecutionPayloadStoreError("VES_PAYLOAD_TOO_LARGE", "Tool payload exceeds its bound");
    const payloadRef = `payload:sha256:${createHash("sha256").update(content).digest("hex")}`;
    if (this.#entries.has(payloadRef)) return payloadRef;
    if (this.#totalBytes + content.byteLength > this.#maximumTotalBytes)
      throw new ExecutionPayloadStoreError("VES_PAYLOAD_STORE_FULL", "Run payload store is full");
    this.#entries.set(payloadRef, Uint8Array.from(content));
    this.#totalBytes += content.byteLength;
    return payloadRef;
  }

  async get(payloadRef: string): Promise<Uint8Array | undefined> {
    if (executionPayloadDigest(payloadRef) === undefined) return undefined;
    const content = this.#entries.get(payloadRef);
    return content === undefined ? undefined : Uint8Array.from(content);
  }
}
