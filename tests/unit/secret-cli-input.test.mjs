// invariant: #379 D5 — `vestra secret set` reads the credential without echo
// from a terminal, strips exactly one trailing newline from a pipe, stops at
// the size budget, and never writes the value to stderr.
import "../helpers/deny-keychain-spawn.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

import { readCredentialValue } from "../../apps/vestra-cli/src/secret-composition.ts";
import { MAX_CREDENTIAL_VALUE_BYTES } from "../../packages/platform-node/src/index.ts";

function input({ tty, chunks, rawMode = true }) {
  const listeners = new Map();
  const raw = [];
  const stream = {
    isTTY: tty,
    on(event, listener) {
      listeners.set(event, listener);
    },
    removeAllListeners() {
      listeners.clear();
    },
    pause() {},
    resume() {
      queueMicrotask(() => {
        for (const chunk of chunks) listeners.get("data")?.(Buffer.from(chunk));
        listeners.get("end")?.();
      });
    }
  };
  if (rawMode) stream.setRawMode = (mode) => raw.push(mode);
  return { stream, raw };
}

async function read(options) {
  const { stream, raw } = input(options);
  const stderr = [];
  const io = { controlRoot: ".", platform: "darwin", stdin: stream, stderr: (value) => stderr.push(value) };
  try {
    const value = await readCredentialValue(io, "anthropic-api-key");
    return { value: value.toString("latin1"), raw, stderr: stderr.join("") };
  } catch (error) {
    return { error, raw, stderr: stderr.join("") };
  }
}

test("a terminal prompt hides input, honours backspace, and restores the terminal", async () => {
  const result = await read({ tty: true, chunks: ["sk-ant-X", "\u007f", "yz", "\r", "ignored-after-enter"] });
  assert.equal(result.value, "sk-ant-yz");
  assert.deepEqual(result.raw, [true, false]);
  assert.match(result.stderr, /^Enter the value for anthropic-api-key \(input is hidden\): \n$/u);
  assert.equal(result.stderr.includes("sk-ant"), false);
});

test("Ctrl-C cancels terminal entry and restores the terminal", async () => {
  const result = await read({ tty: true, chunks: ["sk-ant-partial\u0003"] });
  assert.equal(result.error.code, "VES_SECRET_VALUE_INVALID");
  assert.match(result.error.message, /cancelled/u);
  assert.deepEqual(result.raw, [true, false]);
});

test("a terminal without raw mode is refused rather than echoing the value", async () => {
  const result = await read({ tty: true, chunks: ["sk-ant-x\n"], rawMode: false });
  assert.equal(result.error.code, "VES_SECRET_VALUE_INVALID");
  assert.equal(result.stderr, "");
});

test("piped input strips exactly one trailing newline", async () => {
  assert.equal((await read({ tty: false, chunks: ["sk-ant-", "piped\n"] })).value, "sk-ant-piped");
  assert.equal((await read({ tty: false, chunks: ["sk-ant-piped\r\n"] })).value, "sk-ant-piped");
  assert.equal((await read({ tty: false, chunks: ["sk-ant-piped\n\n"] })).error.code, "VES_SECRET_VALUE_INVALID");
});

test("piped input stops at the size budget", async () => {
  const exact = await read({ tty: false, chunks: ["A".repeat(MAX_CREDENTIAL_VALUE_BYTES), "\n"] });
  assert.equal(exact.value.length, MAX_CREDENTIAL_VALUE_BYTES);
  const over = await read({ tty: false, chunks: ["A".repeat(MAX_CREDENTIAL_VALUE_BYTES + 3)] });
  assert.equal(over.error.code, "VES_SECRET_VALUE_INVALID");
  assert.equal(over.stderr, "");
});
