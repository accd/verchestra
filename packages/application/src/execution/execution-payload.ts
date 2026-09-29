// Tool content travels by digest, not inline: ExecutionToolRequest carries only
// a payloadRef, so the executor's authority checks see a bounded token and the
// writer re-hashes the bytes it resolves. Both sides share this grammar.

export const EXECUTION_PAYLOAD_REF = /^payload:sha256:([a-f0-9]{64})$/u;
// A delete has no content; it still names a payload so every tool request has
// the same shape and idempotency covers it.
export const EXECUTION_PAYLOAD_TOMBSTONE = "payload:none" as const;
export const MAXIMUM_EXECUTION_PAYLOAD_BYTES = 1_048_576;

export interface ExecutionPayloadPort {
  get(payloadRef: string): Promise<Uint8Array | undefined>;
}

export interface ExecutionPayloadStore extends ExecutionPayloadPort {
  put(content: Uint8Array): Promise<string>;
}

export function executionPayloadDigest(payloadRef: string): string | undefined {
  return EXECUTION_PAYLOAD_REF.exec(payloadRef)?.[1];
}
