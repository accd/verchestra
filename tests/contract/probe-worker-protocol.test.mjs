import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ProbeFrameDecoder,
  ProbeSequenceGuard,
  encodeProbeFrame,
  negotiateProbeHandshake
} from "../../packages/extension-host/src/index.ts";
import { workspaceId } from "../helpers/database-probe-fixture.mjs";

function envelope(overrides = {}) {
  return {
    protocol: "verchestra-probe/1",
    messageId: "message-1",
    correlationId: "probe-request-001",
    workspaceId,
    sequence: 0,
    payloadSchema: { name: "probe.result.chunk", version: 1 },
    payload: { rows: 1, bytes: 10 },
    ...overrides
  };
}

for (const split of [0, 1, 7, 31, 64]) {
  test(`probe frame round-trips across split ${split}`, () => {
    const frame = encodeProbeFrame(envelope());
    const decoder = new ProbeFrameDecoder({ workspaceId, maximumHeaderBytes: 128, maximumMessageBytes: 2048 });
    const decoded = [...decoder.push(frame.subarray(0, split)), ...decoder.push(frame.subarray(split))];
    assert.equal(decoded.length, 1);
    assert.deepEqual(decoded[0].payload, { rows: 1, bytes: 10 });
  });
}

test("multiple probe frames decode in one chunk", () => {
  const decoder = new ProbeFrameDecoder({ workspaceId, maximumHeaderBytes: 128, maximumMessageBytes: 2048 });
  const bytes = Buffer.concat([encodeProbeFrame(envelope()), encodeProbeFrame(envelope({ messageId: "message-2" }))]);
  assert.equal(decoder.push(bytes).length, 2);
});

for (const [label, bytes, code] of [
  ["missing length", Buffer.from("X: 2\r\n\r\n{}"), "VES_PROBE_FRAME_LENGTH_REQUIRED"],
  [
    "duplicate length",
    Buffer.from("Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}"),
    "VES_PROBE_FRAME_HEADER_INVALID"
  ],
  ["negative length", Buffer.from("Content-Length: -1\r\n\r\n"), "VES_PROBE_FRAME_LENGTH_INVALID"],
  ["leading zero", Buffer.from("Content-Length: 02\r\n\r\n{}"), "VES_PROBE_FRAME_LENGTH_INVALID"],
  ["invalid json", Buffer.from("Content-Length: 1\r\n\r\n{"), "VES_PROBE_FRAME_JSON_INVALID"],
  ["oversized body", Buffer.from("Content-Length: 9999\r\n\r\n"), "VES_PROBE_FRAME_MESSAGE_LIMIT"]
]) {
  test(`malformed probe frame fails closed: ${label}`, () => {
    const decoder = new ProbeFrameDecoder({ workspaceId, maximumHeaderBytes: 64, maximumMessageBytes: 128 });
    assert.throws(() => decoder.push(bytes), { code, terminateWorker: true, revokeGrant: true });
  });
}

test("sequence guard accepts contiguous messages and idempotent replay", () => {
  const guard = new ProbeSequenceGuard();
  const first = { messageId: "one", sequence: 0, payloadDigest: `sha256:${"1".repeat(64)}` };
  assert.equal(guard.accept(first).accepted, true);
  assert.equal(guard.accept(first).duplicate, true);
  assert.equal(guard.accept({ ...first, messageId: "two", sequence: 1 }).accepted, true);
});

test("sequence gap terminates worker and revokes grant", () => {
  const guard = new ProbeSequenceGuard();
  assert.throws(() => guard.accept({ messageId: "one", sequence: 1, payloadDigest: `sha256:${"1".repeat(64)}` }), {
    code: "VES_PROBE_SEQUENCE_GAP",
    terminateWorker: true,
    revokeGrant: true
  });
});

test("message identity conflict terminates worker and revokes grant", () => {
  const guard = new ProbeSequenceGuard();
  guard.accept({ messageId: "one", sequence: 0, payloadDigest: `sha256:${"1".repeat(64)}` });
  assert.throws(() => guard.accept({ messageId: "one", sequence: 0, payloadDigest: `sha256:${"2".repeat(64)}` }), {
    code: "VES_PROBE_MESSAGE_CONFLICT",
    terminateWorker: true,
    revokeGrant: true
  });
});

function handshakes() {
  return {
    controller: {
      protocol: "verchestra-probe/1",
      requiredSchemas: ["probe.plan/1", "probe.result/1"],
      expectedComponent: { id: "probe-worker:mock", digest: `sha256:${"1".repeat(64)}` },
      allowedCapabilities: ["database-read"],
      maximumMessageBytes: 65536
    },
    worker: {
      protocol: "verchestra-probe/1",
      supportedSchemas: ["probe.plan/1", "probe.result/1"],
      component: { id: "probe-worker:mock", digest: `sha256:${"1".repeat(64)}` },
      capabilities: ["database-read"],
      maximumMessageBytes: 32768
    }
  };
}

test("handshake binds exact component, schemas, capability, and message bound", () => {
  const value = handshakes();
  assert.equal(negotiateProbeHandshake(value.controller, value.worker).maximumMessageBytes, 32768);
});

for (const [label, mutate, code] of [
  ["protocol", (v) => ({ ...v, protocol: "probe/2" }), "VES_PROBE_HANDSHAKE_PROTOCOL"],
  ["schema", (v) => ({ ...v, supportedSchemas: [] }), "VES_PROBE_HANDSHAKE_SCHEMA"],
  [
    "component",
    (v) => ({ ...v, component: { ...v.component, id: "probe-worker:other" } }),
    "VES_PROBE_HANDSHAKE_COMPONENT"
  ],
  [
    "digest",
    (v) => ({ ...v, component: { ...v.component, digest: `sha256:${"2".repeat(64)}` } }),
    "VES_PROBE_HANDSHAKE_COMPONENT"
  ],
  ["capability", (v) => ({ ...v, capabilities: ["database-write"] }), "VES_PROBE_HANDSHAKE_CAPABILITY"]
]) {
  test(`handshake rejects ${label} drift`, () => {
    const value = handshakes();
    assert.throws(() => negotiateProbeHandshake(value.controller, mutate(value.worker)), {
      code,
      terminateWorker: true,
      revokeGrant: true
    });
  });
}

// #58/T4: the probe envelope's `payloadDigest` was produced by a private
// recursive serializer whose object keys were ordered with
// `String.prototype.localeCompare`. Mocking `localeCompare` with a comparator
// that reverses code-unit order simulates a hostile or merely divergent locale
// without depending on any specific installed ICU locale actually disagreeing
// today.
function withHostileLocaleCompare(fn) {
  const original = String.prototype.localeCompare;
  String.prototype.localeCompare = function hostileLocaleCompare(other) {
    const left = String(this);
    return left < other ? 1 : left > other ? -1 : 0;
  };
  try {
    return fn();
  } finally {
    String.prototype.localeCompare = original;
  }
}

// Mixed-case keys are where locale collation and code-unit order actually part
// company: ICU collates case-insensitively at its primary level, so "alpha"
// sorts before "Beta", while UTF-16 code units put every uppercase key first.
const mixedCaseRows = Object.freeze({
  rows: Object.freeze([Object.freeze({ alpha: 1, Beta: 2, Zeta: Object.freeze({ inner: 3, Inner: 4 }) })]),
  bytes: 10
});

test("a probe frame encoded under a hostile locale is byte-identical and still decodes", () => {
  const plain = encodeProbeFrame(envelope({ payload: mixedCaseRows }));
  const hostile = withHostileLocaleCompare(() => encodeProbeFrame(envelope({ payload: mixedCaseRows })));
  assert.deepEqual(hostile, plain);

  // The host re-derives the digest on receipt, so a worker and a host whose
  // locales disagreed would terminate the worker and revoke its grant on every
  // result chunk.
  const decoder = new ProbeFrameDecoder({ workspaceId, maximumHeaderBytes: 128, maximumMessageBytes: 2048 });
  const decoded = decoder.push(hostile);
  assert.equal(decoded.length, 1);
  assert.deepEqual(decoded[0].payload, mixedCaseRows);

  // A tampered payload digest still terminates the worker: the canonical swap
  // did not soften the check it feeds.
  const tampered = encodeProbeFrame(envelope({ payload: mixedCaseRows, payloadDigest: `sha256:${"c".repeat(64)}` }));
  assert.throws(
    () => new ProbeFrameDecoder({ workspaceId, maximumHeaderBytes: 128, maximumMessageBytes: 2048 }).push(tampered),
    { code: "VES_PROBE_ENVELOPE_DIGEST", terminateWorker: true, revokeGrant: true }
  );
});
