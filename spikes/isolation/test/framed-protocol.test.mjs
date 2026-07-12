import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BoundedEventQueue,
  FrameDecoder,
  SequenceGuard,
  createEnvelope,
  encodeFrame,
  negotiateHandshake
} from "../src/framed-protocol.mjs";

function envelope(overrides = {}) {
  return createEnvelope({
    messageId: "msg-1",
    correlationId: "corr-1",
    workspaceId: "workspace-a",
    sequence: 0,
    sentAt: "2026-07-12T12:00:00.000Z",
    payloadSchema: "ves://worker/event@1",
    payload: { text: "olá" },
    ...overrides
  });
}

test("encodes Content-Length from UTF-8 bytes rather than characters", () => {
  const value = envelope();
  const frame = encodeFrame(value);
  const [header, body] = frame.toString("utf8").split("\r\n\r\n");
  assert.equal(header, `Content-Length: ${Buffer.byteLength(body)}`);
  assert.deepEqual(JSON.parse(body), value);
});

test("decodes a frame split across arbitrary chunks", () => {
  const frame = encodeFrame(envelope());
  const decoder = new FrameDecoder({ workspaceId: "workspace-a" });
  assert.deepEqual(decoder.push(frame.subarray(0, 7)), []);
  assert.deepEqual(decoder.push(frame.subarray(7, 31)), []);
  assert.deepEqual(decoder.push(frame.subarray(31)), [envelope()]);
});

test("decodes multiple frames from one chunk", () => {
  const first = envelope();
  const second = envelope({ messageId: "msg-2", sequence: 1, payload: { text: "second" } });
  const decoder = new FrameDecoder({ workspaceId: "workspace-a" });
  assert.deepEqual(decoder.push(Buffer.concat([encodeFrame(first), encodeFrame(second)])), [first, second]);
});

test("rejects headers exceeding the configured bound", () => {
  const decoder = new FrameDecoder({ workspaceId: "workspace-a", maxHeaderBytes: 24 });
  assert.throws(() => decoder.push(Buffer.from("Content-Length: 1\r\nX-Fill: 123456789\r\n\r\n{}")), { code: "VES_FRAME_HEADER_LIMIT", grantsRevoked: true, terminationRequired: true });
});

test("rejects a missing Content-Length header", () => {
  const decoder = new FrameDecoder({ workspaceId: "workspace-a" });
  assert.throws(() => decoder.push(Buffer.from("X-Test: 1\r\n\r\n{}")), { code: "VES_FRAME_LENGTH_REQUIRED", grantsRevoked: true, terminationRequired: true });
});

test("rejects duplicate Content-Length headers", () => {
  const decoder = new FrameDecoder({ workspaceId: "workspace-a" });
  assert.throws(() => decoder.push(Buffer.from("Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}")), { code: "VES_FRAME_HEADER_INVALID", grantsRevoked: true, terminationRequired: true });
});

test("rejects non-canonical or negative Content-Length", () => {
  for (const value of ["-1", "+2", "2.0", "02", "abc"]) {
    const decoder = new FrameDecoder({ workspaceId: "workspace-a" });
    assert.throws(() => decoder.push(Buffer.from(`Content-Length: ${value}\r\n\r\n{}`)), { code: "VES_FRAME_LENGTH_INVALID", grantsRevoked: true, terminationRequired: true });
  }
});

test("rejects a declared message larger than the negotiated maximum", () => {
  const decoder = new FrameDecoder({ workspaceId: "workspace-a", maxMessageBytes: 64 });
  assert.throws(() => decoder.push(Buffer.from("Content-Length: 65\r\n\r\n")), { code: "VES_FRAME_MESSAGE_LIMIT", grantsRevoked: true, terminationRequired: true });
});

test("rejects malformed JSON without inferring a message", () => {
  const decoder = new FrameDecoder({ workspaceId: "workspace-a" });
  assert.throws(() => decoder.push(Buffer.from("Content-Length: 1\r\n\r\n{")), { code: "VES_FRAME_JSON_INVALID", grantsRevoked: true, terminationRequired: true });
});

test("rejects a payload digest mismatch", () => {
  const value = { ...envelope(), payloadDigest: "0".repeat(64) };
  const decoder = new FrameDecoder({ workspaceId: "workspace-a" });
  assert.throws(() => decoder.push(encodeFrame(value)), { code: "VES_ENVELOPE_DIGEST_MISMATCH", grantsRevoked: true, terminationRequired: true });
});

test("rejects an envelope schema failure and requires worker termination", () => {
  const { messageId, ...invalid } = envelope();
  const decoder = new FrameDecoder({ workspaceId: "workspace-a" });
  assert.throws(() => decoder.push(encodeFrame(invalid)), { code: "VES_ENVELOPE_SCHEMA_INVALID", grantsRevoked: true, terminationRequired: true });
});

test("rejects an envelope from another Workspace", () => {
  const decoder = new FrameDecoder({ workspaceId: "workspace-a" });
  assert.throws(() => decoder.push(encodeFrame(envelope({ workspaceId: "workspace-b" }))), { code: "VES_ENVELOPE_WORKSPACE_MISMATCH", grantsRevoked: true, terminationRequired: true });
});

test("sequence gaps terminate the protocol grant", () => {
  const guard = new SequenceGuard();
  assert.deepEqual(guard.accept(envelope()), { accepted: true, duplicate: false, nextSequence: 1 });
  assert.throws(() => guard.accept(envelope({ messageId: "msg-3", sequence: 2 })), { code: "VES_SEQUENCE_GAP", grantsRevoked: true, terminationRequired: true });
});

test("an incompatible duplicate message ID terminates the protocol grant", () => {
  const guard = new SequenceGuard();
  guard.accept(envelope());
  assert.throws(() => guard.accept(envelope({ payload: { text: "changed" } })), { code: "VES_MESSAGE_ID_CONFLICT", grantsRevoked: true, terminationRequired: true });
});

test("a byte-identical duplicate is idempotently ignored", () => {
  const guard = new SequenceGuard();
  const value = envelope();
  guard.accept(value);
  assert.deepEqual(guard.accept(value), { accepted: false, duplicate: true, nextSequence: 1 });
});

function controller(overrides = {}) {
  return {
    protocol: "verchestra/1",
    requiredSchemas: ["ves://worker/event@1"],
    supportedSchemas: ["ves://worker/event@1", "ves://worker/cancel@1"],
    expectedComponent: { id: "probe-host", digest: "a".repeat(64) },
    allowedCapabilities: ["db.read", "fs.read"],
    maxMessageBytes: 4096,
    ...overrides
  };
}

function worker(overrides = {}) {
  return {
    protocol: "verchestra/1",
    supportedSchemas: ["ves://worker/event@1"],
    component: { id: "probe-host", digest: "a".repeat(64) },
    capabilities: ["db.read"],
    maxMessageBytes: 2048,
    ...overrides
  };
}

test("handshake binds protocol, schemas, component identity, capabilities, and maximum size", () => {
  assert.deepEqual(negotiateHandshake(controller(), worker()), {
    protocol: "verchestra/1",
    schemas: ["ves://worker/event@1"],
    component: { id: "probe-host", digest: "a".repeat(64) },
    capabilities: ["db.read"],
    maxMessageBytes: 2048,
    grantsRevoked: false
  });
});

test("handshake rejects a protocol major mismatch", () => {
  assert.throws(() => negotiateHandshake(controller(), worker({ protocol: "verchestra/2" })), { code: "VES_HANDSHAKE_PROTOCOL_MISMATCH", grantsRevoked: true, terminationRequired: true });
});

test("handshake rejects a missing required schema", () => {
  assert.throws(() => negotiateHandshake(controller(), worker({ supportedSchemas: ["ves://other@1"] })), { code: "VES_HANDSHAKE_SCHEMA_MISMATCH", grantsRevoked: true, terminationRequired: true });
});

test("handshake rejects a component identity or digest mismatch", () => {
  assert.throws(() => negotiateHandshake(controller(), worker({ component: { id: "impostor", digest: "b".repeat(64) } })), { code: "VES_HANDSHAKE_IDENTITY_MISMATCH", grantsRevoked: true, terminationRequired: true });
});

test("handshake rejects capability escalation", () => {
  assert.throws(() => negotiateHandshake(controller(), worker({ capabilities: ["db.read", "process.exec"] })), { code: "VES_HANDSHAKE_CAPABILITY_ESCALATION", grantsRevoked: true, terminationRequired: true });
});

test("bounded queue pauses at high water and resumes below low water", () => {
  const queue = new BoundedEventQueue({ capacity: 3, highWater: 2, lowWater: 1 });
  assert.deepEqual(queue.push("a"), { size: 1, pauseReads: false });
  assert.deepEqual(queue.push("b"), { size: 2, pauseReads: true });
  assert.deepEqual(queue.shift(), { value: "a", size: 1, resumeReads: true });
});

test("bounded queue overflow cancels instead of dropping or growing", () => {
  const queue = new BoundedEventQueue({ capacity: 2, highWater: 1, lowWater: 0 });
  queue.push("a");
  queue.push("b");
  assert.throws(() => queue.push("c"), { code: "VES_BACKPRESSURE_LIMIT", cancellationRequired: true });
  assert.equal(queue.size, 2);
});
