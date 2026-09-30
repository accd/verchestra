import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { readBoundedLines } from "../../packages/agent-runtime/src/execution/mcp-bridge-protocol.ts";

function reader(maximumBytes) {
  const stream = new PassThrough();
  const lines = [];
  let overflows = 0;
  readBoundedLines(
    stream,
    (line) => lines.push(line),
    () => (overflows += 1),
    maximumBytes
  );
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return { stream, lines, overflows: () => overflows, settle };
}

test("lines are reassembled across chunks, CRLF is trimmed, and empty lines are dropped", async () => {
  const { stream, lines, overflows, settle } = reader(64);
  stream.write(Buffer.from('{"a":'));
  stream.write("1}\r\n\n");
  stream.write(Buffer.from("second\nthi"));
  stream.write("rd\n");
  await settle();
  assert.deepEqual(lines, ['{"a":1}', "second", "third"]);
  assert.equal(overflows(), 0);
});

test("a complete line over the bound overflows once and stops delivering lines", async () => {
  const { stream, lines, overflows, settle } = reader(8);
  stream.write("ok\n");
  stream.write(`${"x".repeat(9)}\nlater\n`);
  stream.write("after\n");
  await settle();
  assert.deepEqual(lines, ["ok"]);
  assert.equal(overflows(), 1);
});

test("an unterminated line over the bound overflows without waiting for its newline", async () => {
  const { stream, lines, overflows, settle } = reader(8);
  stream.write("12345");
  stream.write("6789");
  await settle();
  assert.equal(overflows(), 1);
  stream.write("\nnext\n");
  await settle();
  assert.deepEqual(lines, []);
  assert.equal(overflows(), 1);
});

test("a line of exactly the bound is delivered", async () => {
  const { stream, lines, overflows, settle } = reader(8);
  stream.write("12345678\n");
  await settle();
  assert.deepEqual(lines, ["12345678"]);
  assert.equal(overflows(), 0);
});
