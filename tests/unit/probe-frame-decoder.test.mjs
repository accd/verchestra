import assert from "node:assert/strict";
import { test } from "node:test";

import { ProbeFrameDecoder, ProbeProtocolError, encodeProbeFrame } from "../../packages/extension-host/src/index.ts";
import { workspaceId } from "../helpers/database-probe-fixture.mjs";

const frame = (sequence = 0) =>
  encodeProbeFrame({
    protocol: "verchestra-probe/1",
    messageId: `worker:${sequence}`,
    correlationId: "probe-channel:decoder",
    workspaceId,
    sequence,
    payloadSchema: { name: "probe.result.chunk", version: 1 },
    payload: { rows: [{ value: sequence }] }
  });

const decoder = (limits = {}) =>
  new ProbeFrameDecoder({ workspaceId, maximumHeaderBytes: 64, maximumMessageBytes: 65_536, ...limits });

const terminated = (code, message) => (error) =>
  error instanceof ProbeProtocolError &&
  error.code === code &&
  error.message === message &&
  error.terminateWorker &&
  error.revokeGrant;

for (const split of [1, 5, 19, 40]) {
  test(`a probe frame split after byte ${split} decodes once its body is complete`, () => {
    const bytes = frame();
    const probe = decoder();
    assert.deepEqual(probe.push(bytes.subarray(0, split)), []);
    const [envelope] = probe.push(bytes.subarray(split));
    assert.deepEqual(envelope.payload, { rows: [{ value: 0 }] });
  });
}

test("several probe frames in one chunk decode in order and leave a partial frame pending", () => {
  const third = frame(2);
  const probe = decoder();
  const decoded = probe.push(Buffer.concat([frame(0), frame(1), third.subarray(0, 30)]));
  assert.deepEqual(
    decoded.map((entry) => entry.sequence),
    [0, 1]
  );
  assert.deepEqual(
    probe.push(third.subarray(30)).map((entry) => entry.sequence),
    [2]
  );
});

test("an unterminated header longer than its limit is refused before the boundary arrives", () => {
  assert.throws(
    () => decoder({ maximumHeaderBytes: 8 }).push(Buffer.from("Content-Length: 2")),
    terminated("VES_PROBE_FRAME_HEADER_LIMIT", "Probe frame header exceeds its limit")
  );
});

test("an unterminated header within its limit waits for more bytes", () => {
  assert.deepEqual(decoder().push(Buffer.from("Content-Len")), []);
});

test("a complete header longer than its limit is refused", () => {
  assert.throws(
    () => decoder({ maximumHeaderBytes: 8 }).push(Buffer.from("Content-Length: 2\r\n\r\n{}")),
    terminated("VES_PROBE_FRAME_HEADER_LIMIT", "Probe frame header exceeds its limit")
  );
});

for (const [name, bytes, code, message] of [
  ["a missing length", "X: 1\r\n\r\n{}", "VES_PROBE_FRAME_LENGTH_REQUIRED", "Probe frame requires Content-Length"],
  [
    "an extra header",
    "Content-Length: 2\r\nX: 1\r\n\r\n{}",
    "VES_PROBE_FRAME_HEADER_INVALID",
    "Probe frame headers are invalid"
  ],
  [
    "a signed length",
    "Content-Length: +2\r\n\r\n{}",
    "VES_PROBE_FRAME_LENGTH_INVALID",
    "Probe frame length is invalid"
  ],
  [
    "an unsafe length",
    "Content-Length: 99999999999999999999\r\n\r\n",
    "VES_PROBE_FRAME_LENGTH_INVALID",
    "Probe frame length is unsafe"
  ],
  [
    "an oversized body",
    "Content-Length: 70000\r\n\r\n",
    "VES_PROBE_FRAME_MESSAGE_LIMIT",
    "Probe frame body exceeds its limit"
  ],
  [
    "a body that is not JSON",
    "Content-Length: 1\r\n\r\n{",
    "VES_PROBE_FRAME_JSON_INVALID",
    "Probe frame body is invalid JSON"
  ]
]) {
  test(`the probe decoder refuses ${name}`, () => {
    assert.throws(() => decoder().push(Buffer.from(bytes)), terminated(code, message));
  });
}

test("a missing length is reported before a duplicated header", () => {
  assert.throws(
    () => decoder().push(Buffer.from("X: 1\r\nY: 2\r\n\r\n{}")),
    terminated("VES_PROBE_FRAME_LENGTH_REQUIRED", "Probe frame requires Content-Length")
  );
});
