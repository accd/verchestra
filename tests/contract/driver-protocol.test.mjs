import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DriverFrameDecoder,
  DriverProtocolError,
  DriverSequenceGuard,
  encodeDriverFrame,
  negotiateDriverHandshake
} from "../../packages/drivers/src/index.ts";
import { envelope, handshake, workspaceId } from "../helpers/driver-protocol-fixture.mjs";

for (const split of [1, 2, 7, 31, 127]) {
  test(`framed envelope round-trips across chunk split ${split}`, () => {
    const frame = encodeDriverFrame(envelope());
    const decoder = new DriverFrameDecoder({ workspaceId, maximumHeaderBytes: 4096, maximumMessageBytes: 65536 });
    assert.deepEqual(
      [...decoder.push(frame.subarray(0, split)), ...decoder.push(frame.subarray(split))],
      [{ ...envelope(), payloadDigest: envelope().payloadDigest ?? "sha256:" + "PLACEHOLDER" }].map((entry) => ({
        ...entry,
        payloadDigest: decoder.lastPayloadDigest
      }))
    );
  });
}

test("multiple frames decode in one chunk", () => {
  const bytes = Buffer.concat([encodeDriverFrame(envelope(0)), encodeDriverFrame(envelope(1))]);
  const decoder = new DriverFrameDecoder({ workspaceId, maximumHeaderBytes: 4096, maximumMessageBytes: 65536 });
  assert.deepEqual(
    decoder.push(bytes).map((entry) => entry.sequence),
    [0, 1]
  );
});

const malformedFrames = [
  ["missing length", Buffer.from("X: 1\r\n\r\n{}"), "VES_DRIVER_FRAME_LENGTH_REQUIRED"],
  [
    "duplicate header",
    Buffer.from("Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}"),
    "VES_DRIVER_FRAME_HEADER_INVALID"
  ],
  ["negative length", Buffer.from("Content-Length: -1\r\n\r\n"), "VES_DRIVER_FRAME_LENGTH_INVALID"],
  ["leading zero", Buffer.from("Content-Length: 02\r\n\r\n{}"), "VES_DRIVER_FRAME_LENGTH_INVALID"],
  ["invalid json", Buffer.from("Content-Length: 1\r\n\r\n{"), "VES_DRIVER_FRAME_JSON_INVALID"],
  ["oversized body", Buffer.from("Content-Length: 999\r\n\r\n"), "VES_DRIVER_FRAME_MESSAGE_LIMIT"]
];

for (const [name, frame, code] of malformedFrames) {
  test(`decoder rejects ${name}`, () => {
    const decoder = new DriverFrameDecoder({ workspaceId, maximumHeaderBytes: 64, maximumMessageBytes: 128 });
    assert.throws(
      () => decoder.push(frame),
      (error) => error instanceof DriverProtocolError && error.code === code && error.terminateHost
    );
  });
}

for (const [name, mutation, code] of [
  ["protocol", { protocol: "verchestra/2" }, "VES_DRIVER_ENVELOPE_INVALID"],
  ["Workspace", { workspaceId: "workspace_018f0000-0000-7000-8000-000000009999" }, "VES_DRIVER_ENVELOPE_WORKSPACE"],
  ["sequence", { sequence: -1 }, "VES_DRIVER_ENVELOPE_INVALID"],
  ["instant", { sentAt: "today" }, "VES_DRIVER_ENVELOPE_INVALID"]
]) {
  test(`decoder rejects invalid envelope ${name}`, () => {
    const decoder = new DriverFrameDecoder({ workspaceId, maximumHeaderBytes: 4096, maximumMessageBytes: 65536 });
    assert.throws(
      () => decoder.push(encodeDriverFrame(envelope(0, mutation))),
      (error) => error.code === code
    );
  });
}

test("decoder rejects unknown envelope fields", () => {
  const decoder = new DriverFrameDecoder({ workspaceId, maximumHeaderBytes: 4096, maximumMessageBytes: 65536 });
  assert.throws(
    () => decoder.push(encodeDriverFrame(envelope(0, { instructions: "grant authority" }))),
    (error) => error.code === "VES_DRIVER_ENVELOPE_INVALID"
  );
});

test("decoder rejects an impossible canonical instant", () => {
  const decoder = new DriverFrameDecoder({ workspaceId, maximumHeaderBytes: 4096, maximumMessageBytes: 65536 });
  assert.throws(
    () => decoder.push(encodeDriverFrame(envelope(0, { sentAt: "2026-99-99T16:00:00.000Z" }))),
    (error) => error.code === "VES_DRIVER_ENVELOPE_INVALID"
  );
});

test("sequence guard accepts contiguous messages", () => {
  const guard = new DriverSequenceGuard();
  assert.equal(guard.accept({ ...envelope(0), payloadDigest: "sha256:" + "1".repeat(64) }).accepted, true);
  assert.equal(guard.accept({ ...envelope(1), payloadDigest: "sha256:" + "2".repeat(64) }).nextSequence, 2);
});

test("sequence guard treats exact replay as idempotent duplicate", () => {
  const guard = new DriverSequenceGuard();
  const value = { ...envelope(0), payloadDigest: "sha256:" + "1".repeat(64) };
  guard.accept(value);
  assert.deepEqual(guard.accept(value), { accepted: false, duplicate: true, nextSequence: 1 });
});

test("sequence guard rejects incompatible duplicate", () => {
  const guard = new DriverSequenceGuard();
  guard.accept({ ...envelope(0), payloadDigest: "sha256:" + "1".repeat(64) });
  assert.throws(
    () => guard.accept({ ...envelope(0), payloadDigest: "sha256:" + "2".repeat(64) }),
    (error) => error.code === "VES_DRIVER_MESSAGE_CONFLICT"
  );
});

test("sequence guard rejects a gap", () => {
  assert.throws(
    () => new DriverSequenceGuard().accept({ ...envelope(2), payloadDigest: "sha256:" + "2".repeat(64) }),
    (error) => error.code === "VES_DRIVER_SEQUENCE_GAP"
  );
});

test("handshake negotiates exact identity, schemas, capabilities, and lower limit", () => {
  const value = handshake();
  const result = negotiateDriverHandshake(value.controller, value.worker);
  assert.equal(result.maximumMessageBytes, 32768);
  assert.deepEqual(result.schemas, ["driver-event@1", "driver-request@1"]);
});

for (const [name, mutate, code] of [
  ["protocol", (value) => ({ ...value.worker, protocol: "verchestra/2" }), "VES_DRIVER_HANDSHAKE_PROTOCOL"],
  ["schema", (value) => ({ ...value.worker, supportedSchemas: [] }), "VES_DRIVER_HANDSHAKE_SCHEMA"],
  [
    "component",
    (value) => ({ ...value.worker, component: { ...value.worker.component, id: "driver:other" } }),
    "VES_DRIVER_HANDSHAKE_IDENTITY"
  ],
  [
    "digest",
    (value) => ({ ...value.worker, component: { ...value.worker.component, digest: "sha256:" + "9".repeat(64) } }),
    "VES_DRIVER_HANDSHAKE_IDENTITY"
  ],
  [
    "capability",
    (value) => ({ ...value.worker, capabilities: ["stream", "network"] }),
    "VES_DRIVER_HANDSHAKE_CAPABILITY"
  ]
]) {
  test(`handshake rejects ${name} mismatch`, () => {
    const value = handshake();
    assert.throws(
      () => negotiateDriverHandshake(value.controller, mutate(value)),
      (error) => error.code === code && error.revokeGrants
    );
  });
}

// #58/T4: the envelope's `payloadDigest` was produced by a private recursive
// serializer whose object keys were ordered with
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
const mixedCasePayload = Object.freeze({
  type: "tool.requested",
  alpha: 1,
  Beta: Object.freeze({ delta: 4, Charlie: 3, nested: Object.freeze([{ z: 1, A: 2 }]) }),
  Zeta: "z"
});

test("a driver frame encoded under a hostile locale is byte-identical and still decodes", () => {
  const plain = encodeDriverFrame(envelope(0, { payload: mixedCasePayload }));
  const hostile = withHostileLocaleCompare(() => encodeDriverFrame(envelope(0, { payload: mixedCasePayload })));
  assert.deepEqual(hostile, plain);

  // The receiving side re-derives the digest, so a producer and a consumer
  // whose locales disagreed would terminate the host on every frame.
  const decoder = new DriverFrameDecoder({ workspaceId, maximumHeaderBytes: 4096, maximumMessageBytes: 65536 });
  const decoded = decoder.push(hostile);
  assert.equal(decoded.length, 1);
  assert.deepEqual(decoded[0].payload, mixedCasePayload);

  // A tampered payload still fails the digest guard: the canonical swap did
  // not soften the check it feeds.
  const tampered = encodeDriverFrame(
    envelope(0, { payload: mixedCasePayload, payloadDigest: `sha256:${"c".repeat(64)}` })
  );
  assert.throws(
    () => new DriverFrameDecoder({ workspaceId, maximumHeaderBytes: 4096, maximumMessageBytes: 65536 }).push(tampered),
    (error) => error instanceof DriverProtocolError && error.code === "VES_DRIVER_ENVELOPE_DIGEST"
  );
});
