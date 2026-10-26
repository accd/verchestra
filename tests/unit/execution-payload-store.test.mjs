// invariant: ARQ-008 (#597). A run's mediated writes are bounded twice: each
// write by MAXIMUM_EXECUTION_PAYLOAD_BYTES, and all of them together by
// MAXIMUM_RUN_PAYLOAD_BYTES. The store never evicts, so a write past the total
// is refused while every payload already kept stays readable.
import assert from "node:assert/strict";
import { test } from "node:test";

import { InMemoryExecutionPayloadStore, MAXIMUM_RUN_PAYLOAD_BYTES } from "../../packages/agent-runtime/src/index.ts";
import { MAXIMUM_EXECUTION_PAYLOAD_BYTES } from "../../packages/application/src/index.ts";

const bytes = (length, fill) => new Uint8Array(length).fill(fill);

test("the bounds are 1 MiB per write and 64 MiB per run", () => {
  assert.equal(MAXIMUM_EXECUTION_PAYLOAD_BYTES, 1024 * 1024);
  assert.equal(MAXIMUM_RUN_PAYLOAD_BYTES, 64 * 1024 * 1024);
});

test("a write larger than one payload may be is refused as too large", async () => {
  const store = new InMemoryExecutionPayloadStore();
  await assert.rejects(store.put(bytes(MAXIMUM_EXECUTION_PAYLOAD_BYTES + 1, 1)), { code: "VES_PAYLOAD_TOO_LARGE" });
  assert.match(await store.put(bytes(MAXIMUM_EXECUTION_PAYLOAD_BYTES, 1)), /^payload:sha256:[a-f0-9]{64}$/u);
});

test("a write past the run's total is refused as store full, and nothing kept is evicted", async () => {
  const store = new InMemoryExecutionPayloadStore({ maximumTotalBytes: 10 });
  const first = await store.put(bytes(6, 1));
  await assert.rejects(store.put(bytes(5, 2)), { code: "VES_PAYLOAD_STORE_FULL" });
  assert.deepEqual(await store.get(first), bytes(6, 1));
  // why: content-addressed, so the same bytes again take no new room.
  assert.equal(await store.put(bytes(6, 1)), first);
  const second = await store.put(bytes(4, 3));
  await assert.rejects(store.put(bytes(1, 4)), { code: "VES_PAYLOAD_STORE_FULL" });
  assert.deepEqual(await store.get(second), bytes(4, 3));
});

test("a kept payload cannot be changed through what put was given or what get returns", async () => {
  const store = new InMemoryExecutionPayloadStore();
  const content = bytes(3, 7);
  const ref = await store.put(content);
  content.fill(0);
  const read = await store.get(ref);
  read.fill(0);
  assert.deepEqual(await store.get(ref), bytes(3, 7));
  assert.equal(await store.get("payload:not-a-digest"), undefined);
});
